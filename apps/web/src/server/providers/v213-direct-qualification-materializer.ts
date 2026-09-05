import { createHash } from "node:crypto";

import { AwsClient } from "aws4fetch";

import type { SqlExecutor, TransactionalSqlExecutor } from "@videoforge/control-plane";

import type { HostedR2BucketBinding } from "../hosted/configuration.js";
import { HostedR2Signer } from "../hosted/r2.js";
import {
  buildV213QualificationMaterializationRequest,
  cleanupV213QualificationInputs,
  createV213QualificationMaterializerDependencies,
  materializeV213QualificationCase,
  type V208SoulXWholeSpanDescriptor,
  type V213QualificationInputArtifact,
  type V213QualificationMaterializationStore,
  type V213QualificationSourceRef,
} from "../hosted/v213-qualification-materializer.js";
import type {
  V213LaneDeployment,
  V213QualificationCaseDescriptor,
  V213QualificationCaseMaterialization,
} from "./v213-dual-lane-live.js";

const HASH = /^sha256:[0-9a-f]{64}$/u;
const ACCOUNT_ID = /^[0-9a-f]{32}$/u;
const BUCKET = /^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/u;
const ACCESS_KEY = /^[A-Za-z0-9][A-Za-z0-9._-]{15,255}$/u;
const SECRET_KEY = /^[\u0021-\u007e]{32,512}$/u;
const MAX_OBJECT_BYTES = 16 * 1024 * 1024;

interface V213DirectR2Range {
  readonly offset: number;
  readonly length: number;
}

export interface V213QualificationProtectedInputDescriptor {
  readonly path: string;
  readonly sha256: `sha256:${string}`;
  readonly sizeBytes: number;
  readonly contentType: "image/png" | "audio/wav";
}

export interface V213QualificationProtectedInputDescriptors {
  readonly avatarSource: V213QualificationProtectedInputDescriptor;
  readonly soulx2s: V213QualificationProtectedInputDescriptor;
  readonly soulx4s: V213QualificationProtectedInputDescriptor;
  readonly soulx6s: V213QualificationProtectedInputDescriptor;
  readonly soulx10s: V213QualificationProtectedInputDescriptor;
}

export interface V213QualificationProtectedSourceBytes {
  readonly avatarSource: Uint8Array;
  readonly soulx2s: Uint8Array;
  readonly soulx4s: Uint8Array;
  readonly soulx6s: Uint8Array;
  readonly soulx10s: Uint8Array;
}

export interface V213QualificationSourceRefs {
  readonly caseSource: V213QualificationSourceRef;
  readonly generators: Readonly<{
    readonly mage: V213QualificationSourceRef;
    readonly soulx: V213QualificationSourceRef;
  }>;
  readonly validators: Readonly<{
    readonly mage: V213QualificationSourceRef;
    readonly soulx: V213QualificationSourceRef;
  }>;
}

export interface V213DirectQualificationR2Configuration {
  readonly accountId: string;
  readonly bucketName: string;
  readonly accessKeyId: string;
  readonly secretAccessKey: string;
}

type R2Signer = Pick<HostedR2Signer, "sign" | "signGenerated">;

function sha256(bytes: Uint8Array): `sha256:${string}` {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function exactKeys(value: object, keys: readonly string[]): boolean {
  return Object.keys(value).sort().join(",") === [...keys].sort().join(",");
}

function validSourceRef(value: V213QualificationSourceRef): boolean {
  return (
    exactKeys(value, ["path", "sha256"]) &&
    value.path.length >= 3 &&
    value.path.length <= 400 &&
    !value.path.startsWith("/") &&
    !value.path.split("/").includes("..") &&
    HASH.test(value.sha256)
  );
}

function validProtectedDescriptor(
  value: V213QualificationProtectedInputDescriptor,
  contentType: "image/png" | "audio/wav",
): boolean {
  return (
    exactKeys(value, ["contentType", "path", "sha256", "sizeBytes"]) &&
    value.contentType === contentType &&
    value.path.startsWith(".videoforge/private/") &&
    !value.path.split("/").includes("..") &&
    HASH.test(value.sha256) &&
    Number.isSafeInteger(value.sizeBytes) &&
    value.sizeBytes >= 44 &&
    value.sizeBytes <= MAX_OBJECT_BYTES
  );
}

function exactProtectedBytes(
  descriptor: V213QualificationProtectedInputDescriptor,
  bytes: Uint8Array,
): Uint8Array<ArrayBuffer> {
  if (
    bytes.byteLength !== descriptor.sizeBytes ||
    sha256(bytes) !== descriptor.sha256 ||
    bytes.byteLength > MAX_OBJECT_BYTES
  )
    throw new Error("V213_QUALIFICATION_PROTECTED_INPUT_DRIFT");
  return Uint8Array.from(bytes);
}

function readPcm16Mono16k(value: Uint8Array<ArrayBuffer>): Int16Array {
  if (
    value.byteLength < 44 ||
    Buffer.from(value.subarray(0, 4)).toString("ascii") !== "RIFF" ||
    Buffer.from(value.subarray(8, 12)).toString("ascii") !== "WAVE"
  )
    throw new Error("V213_QUALIFICATION_PROTECTED_AUDIO_INVALID");
  const view = new DataView(value.buffer, value.byteOffset, value.byteLength);
  let offset = 12;
  let pcm = false;
  let data: Uint8Array<ArrayBuffer> | null = null;
  while (offset + 8 <= value.byteLength) {
    const id = Buffer.from(value.subarray(offset, offset + 4)).toString("ascii");
    const size = view.getUint32(offset + 4, true);
    const start = offset + 8;
    const end = start + size;
    if (end > value.byteLength) throw new Error("V213_QUALIFICATION_PROTECTED_AUDIO_INVALID");
    if (id === "fmt " && size >= 16)
      pcm =
        view.getUint16(start, true) === 1 &&
        view.getUint16(start + 2, true) === 1 &&
        view.getUint32(start + 4, true) === 16_000 &&
        view.getUint16(start + 12, true) === 2 &&
        view.getUint16(start + 14, true) === 16;
    if (id === "data") data = value.slice(start, end);
    offset = end + (size % 2);
  }
  if (!pcm || data === null || data.byteLength < 2 || data.byteLength % 2 !== 0)
    throw new Error("V213_QUALIFICATION_PROTECTED_AUDIO_INVALID");
  const samples = new Int16Array(data.byteLength / 2);
  const dataView = new DataView(data.buffer, data.byteOffset, data.byteLength);
  for (let index = 0; index < samples.length; index += 1)
    samples[index] = dataView.getInt16(index * 2, true);
  return samples;
}

/** Deterministic 16 kHz PCM16 mono -> 48 kHz PCM16 mono conversion used by the real SoulX worker. */
export function buildV213SoulXQualificationWav(
  source: Uint8Array,
  seconds: 2 | 4 | 6 | 10,
): Uint8Array<ArrayBuffer> {
  const samples = readPcm16Mono16k(Uint8Array.from(source));
  const selected16k = seconds * 16_000;
  if (samples.length < selected16k) throw new Error("V213_QUALIFICATION_PROTECTED_AUDIO_TOO_SHORT");
  const frames48k = Math.max(144_000, seconds * 48_000);
  const output = new Uint8Array(44 + frames48k * 2);
  const view = new DataView(output.buffer);
  const write = (offset: number, text: string) =>
    output.set(
      Uint8Array.from(text, (character) => character.charCodeAt(0)),
      offset,
    );
  write(0, "RIFF");
  view.setUint32(4, output.byteLength - 8, true);
  write(8, "WAVE");
  write(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, 48_000, true);
  view.setUint32(28, 96_000, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  write(36, "data");
  view.setUint32(40, frames48k * 2, true);
  for (let outputIndex = 0; outputIndex < frames48k; outputIndex += 1) {
    const inputIndex = Math.floor(outputIndex / 3);
    view.setInt16(44 + outputIndex * 2, inputIndex < selected16k ? samples[inputIndex]! : 0, true);
  }
  return output;
}

function checksumArrayBuffer(base64: string | null): ArrayBuffer | undefined {
  if (base64 === null || !/^[A-Za-z0-9+/]+={0,2}$/u.test(base64)) return undefined;
  const bytes = Buffer.from(base64, "base64");
  return bytes.byteLength === 32
    ? bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
    : undefined;
}

function exactR2Config(value: V213DirectQualificationR2Configuration): void {
  if (
    !exactKeys(value, ["accessKeyId", "accountId", "bucketName", "secretAccessKey"]) ||
    !ACCOUNT_ID.test(value.accountId) ||
    !BUCKET.test(value.bucketName) ||
    !ACCESS_KEY.test(value.accessKeyId) ||
    !SECRET_KEY.test(value.secretAccessKey) ||
    value.accessKeyId === value.secretAccessKey
  )
    throw new Error("V213_QUALIFICATION_R2_CONFIGURATION_INVALID");
}

/** Provider-free fail-closed boundary used before the production runtime constructs any client. */
export function validateV213DirectQualificationInputs(input: {
  readonly operationId: "mage-live-qualification" | "soulx-live-qualification";
  readonly sourceRefs: V213QualificationSourceRefs;
  readonly protectedInputDescriptors: V213QualificationProtectedInputDescriptors;
  readonly protectedSourceBytes?: V213QualificationProtectedSourceBytes;
  readonly r2: V213DirectQualificationR2Configuration;
}): void {
  exactR2Config(input.r2);
  if (
    !validSourceRef(input.sourceRefs.caseSource) ||
    !validSourceRef(input.sourceRefs.generators.mage) ||
    !validSourceRef(input.sourceRefs.generators.soulx) ||
    !validSourceRef(input.sourceRefs.validators.mage) ||
    !validSourceRef(input.sourceRefs.validators.soulx) ||
    !validProtectedDescriptor(input.protectedInputDescriptors.avatarSource, "image/png") ||
    !validProtectedDescriptor(input.protectedInputDescriptors.soulx2s, "audio/wav") ||
    !validProtectedDescriptor(input.protectedInputDescriptors.soulx4s, "audio/wav") ||
    !validProtectedDescriptor(input.protectedInputDescriptors.soulx6s, "audio/wav") ||
    !validProtectedDescriptor(input.protectedInputDescriptors.soulx10s, "audio/wav")
  )
    throw new Error("V213_QUALIFICATION_STATIC_DESCRIPTOR_INVALID");
  if (input.operationId === "soulx-live-qualification") {
    if (input.protectedSourceBytes === undefined)
      throw new Error("V213_QUALIFICATION_PROTECTED_INPUT_UNAVAILABLE");
    // Rehash every protected file before any database, R2 or RunPod client becomes reachable.
    exactProtectedBytes(
      input.protectedInputDescriptors.avatarSource,
      input.protectedSourceBytes.avatarSource,
    );
    for (const key of ["soulx2s", "soulx4s", "soulx6s", "soulx10s"] as const)
      exactProtectedBytes(input.protectedInputDescriptors[key], input.protectedSourceBytes[key]);
  } else if (input.protectedSourceBytes !== undefined) {
    throw new Error("V213_QUALIFICATION_PROTECTED_INPUT_SCOPE_INVALID");
  }
}

/** Minimal exact S3 binding. It has no bucket-create or inventory capability. */
export function createV213DirectR2Bucket(input: {
  readonly config: V213DirectQualificationR2Configuration;
  readonly fetch?: typeof fetch;
}): HostedR2BucketBinding {
  exactR2Config(input.config);
  const fetchPort = input.fetch ?? globalThis.fetch;
  const client = new AwsClient({
    accessKeyId: input.config.accessKeyId,
    secretAccessKey: input.config.secretAccessKey,
    service: "s3",
    region: "auto",
    retries: 0,
  });
  const endpoint = `https://${input.config.accountId}.r2.cloudflarestorage.com/${encodeURIComponent(input.config.bucketName)}`;
  const url = (key: string) => `${endpoint}/${key.split("/").map(encodeURIComponent).join("/")}`;
  const send = async (key: string, init: RequestInit) =>
    fetchPort(await client.sign(url(key), { ...init, aws: { allHeaders: true } }));
  const metadata = (response: Response) => {
    const size = Number(response.headers.get("content-length"));
    if (!Number.isSafeInteger(size) || size < 0 || size > MAX_OBJECT_BYTES)
      throw new Error("V213_QUALIFICATION_R2_READBACK_INVALID");
    return {
      size,
      httpMetadata: { contentType: response.headers.get("content-type") ?? undefined },
      checksums: {
        sha256: checksumArrayBuffer(response.headers.get("x-amz-checksum-sha256")),
      },
    };
  };
  const exactRange = (value: unknown): V213DirectR2Range | null => {
    if (value === undefined) return null;
    if (
      !value ||
      typeof value !== "object" ||
      Array.isArray(value) ||
      !exactKeys(value, ["range"])
    ) {
      throw new Error("V213_QUALIFICATION_R2_RANGE_INVALID");
    }
    const range = (value as { readonly range?: unknown }).range;
    if (
      !range ||
      typeof range !== "object" ||
      Array.isArray(range) ||
      !exactKeys(range, ["offset", "length"])
    ) {
      throw new Error("V213_QUALIFICATION_R2_RANGE_INVALID");
    }
    const { offset, length } = range as { readonly offset?: unknown; readonly length?: unknown };
    if (
      typeof offset !== "number" ||
      typeof length !== "number" ||
      !Number.isSafeInteger(offset) ||
      !Number.isSafeInteger(length) ||
      offset < 0 ||
      length < 1 ||
      offset > MAX_OBJECT_BYTES - 1 ||
      length > MAX_OBJECT_BYTES - offset
    ) {
      throw new Error("V213_QUALIFICATION_R2_RANGE_INVALID");
    }
    return { offset, length };
  };
  const binding: HostedR2BucketBinding = {
    async head(key: string) {
      const response = await send(key, { method: "HEAD" });
      if (response.status === 404) return null;
      if (response.status !== 200) throw new Error("V213_QUALIFICATION_R2_HEAD_REJECTED");
      return metadata(response);
    },
    async get(key: string, options?: unknown) {
      const range = exactRange(options);
      const response = await send(
        key,
        range
          ? {
              method: "GET",
              headers: {
                Range: `bytes=${range.offset}-${range.offset + range.length - 1}`,
              },
            }
          : { method: "GET" },
      );
      if (response.status === 404) return null;
      if (range) {
        if (response.status !== 206) throw new Error("V213_QUALIFICATION_R2_GET_REJECTED");
        const contentLength = Number(response.headers.get("content-length"));
        const contentRange = /^bytes ([0-9]+)-([0-9]+)\/([0-9]+)$/u.exec(
          response.headers.get("content-range") ?? "",
        );
        const start = contentRange ? Number(contentRange[1]) : NaN;
        const end = contentRange ? Number(contentRange[2]) : NaN;
        const total = contentRange ? Number(contentRange[3]) : NaN;
        if (
          !Number.isSafeInteger(contentLength) ||
          contentLength !== range.length ||
          !contentRange ||
          !Number.isSafeInteger(start) ||
          !Number.isSafeInteger(end) ||
          !Number.isSafeInteger(total) ||
          start !== range.offset ||
          end !== range.offset + range.length - 1 ||
          total < end + 1 ||
          total > MAX_OBJECT_BYTES
        ) {
          throw new Error("V213_QUALIFICATION_R2_GET_READBACK_DRIFT");
        }
        return {
          size: total,
          httpMetadata: { contentType: response.headers.get("content-type") ?? undefined },
          arrayBuffer: async () => {
            const bytes = await response.arrayBuffer();
            if (bytes.byteLength !== range.length || bytes.byteLength > MAX_OBJECT_BYTES)
              throw new Error("V213_QUALIFICATION_R2_GET_READBACK_DRIFT");
            return bytes;
          },
        };
      }
      if (response.status !== 200) throw new Error("V213_QUALIFICATION_R2_GET_REJECTED");
      const observed = metadata(response);
      return {
        size: observed.size,
        httpMetadata: observed.httpMetadata,
        arrayBuffer: async () => {
          const bytes = await response.arrayBuffer();
          if (bytes.byteLength !== observed.size || bytes.byteLength > MAX_OBJECT_BYTES)
            throw new Error("V213_QUALIFICATION_R2_GET_READBACK_DRIFT");
          return bytes;
        },
      };
    },
    async put(key: string, value: ReadableStream | ArrayBuffer | string, options?: unknown) {
      if (!(value instanceof ArrayBuffer))
        throw new Error("V213_QUALIFICATION_R2_PUT_BODY_INVALID");
      const metadataValue = options as
        | { readonly httpMetadata?: { readonly contentType?: string }; readonly sha256?: string }
        | undefined;
      const contentType = metadataValue?.httpMetadata?.contentType;
      const checksum = metadataValue?.sha256;
      if (
        typeof contentType !== "string" ||
        typeof checksum !== "string" ||
        !/^[0-9a-f]{64}$/u.test(checksum) ||
        value.byteLength < 1 ||
        value.byteLength > MAX_OBJECT_BYTES
      )
        throw new Error("V213_QUALIFICATION_R2_PUT_CONTRACT_INVALID");
      const response = await send(key, {
        method: "PUT",
        headers: {
          "content-length": String(value.byteLength),
          "content-type": contentType,
          "x-amz-checksum-sha256": Buffer.from(checksum, "hex").toString("base64"),
        },
        body: value,
      });
      if (response.status !== 200 && response.status !== 201)
        throw new Error("V213_QUALIFICATION_R2_PUT_REJECTED");
      return Object.freeze({ etag: response.headers.get("etag") ?? undefined });
    },
    async delete(key: string | readonly string[]) {
      if (typeof key !== "string") throw new Error("V213_QUALIFICATION_R2_BULK_DELETE_FORBIDDEN");
      const response = await send(key, { method: "DELETE" });
      if (![200, 204, 404].includes(response.status))
        throw new Error("V213_QUALIFICATION_R2_DELETE_REJECTED");
    },
    async list() {
      throw new Error("V213_QUALIFICATION_R2_LIST_FORBIDDEN");
    },
  };
  return Object.freeze(binding);
}

function createStore(
  database: TransactionalSqlExecutor,
  signingKeyHex: string,
): V213QualificationMaterializationStore {
  const withKey = <T>(query: (transaction: SqlExecutor) => Promise<T>) =>
    database.transaction(async (transaction) => {
      await transaction.query("SELECT set_config($1,$2,true)", [
        "videoforge.v213_handoff_key",
        signingKeyHex,
      ]);
      return query(transaction);
    });
  const store: V213QualificationMaterializationStore = {
    claim: (request) =>
      withKey(async (transaction) => {
        const result = await transaction.query<{ value: string }>(
          "SELECT public.videoforge_claim_v213_qualification_materialization($1::jsonb) AS value",
          [JSON.stringify(request)],
        );
        const value = result.rows[0]?.value;
        if (value !== "EXECUTE" && value !== "RECONCILE" && value !== "EXISTING")
          throw new Error("V213_QUALIFICATION_MATERIALIZATION_CLAIM_INVALID");
        return value;
      }),
    persist: (request, materialization) =>
      withKey(async (transaction) => {
        const result = await transaction.query<{ value: unknown }>(
          "SELECT public.videoforge_persist_v213_qualification_materialization($1::jsonb) AS value",
          [JSON.stringify({ request, materialization })],
        );
        return result.rows[0]?.value as never;
      }),
    read: (request) =>
      withKey(async (transaction) => {
        const result = await transaction.query<{ value: unknown }>(
          "SELECT public.videoforge_read_v213_qualification_materialization($1::jsonb) AS value",
          [
            JSON.stringify({
              fullLiveAuthorityId: request.fullLiveAuthorityId,
              operationId: request.operationId,
              caseId: request.descriptor.id,
              stageAuthorityId: request.stageAuthorityId,
              outerStateSha256: request.outerStateSha256,
              requestSha256: request.requestSha256,
            }),
          ],
        );
        return (result.rows[0]?.value ?? null) as never;
      }),
  };
  return Object.freeze(store);
}

function sourceForDescriptor(
  descriptors: V213QualificationProtectedInputDescriptors,
  sources: V213QualificationProtectedSourceBytes,
  descriptor: V213QualificationCaseDescriptor,
): {
  readonly avatar: Uint8Array<ArrayBuffer>;
  readonly audio: Uint8Array<ArrayBuffer>;
} {
  const avatar = exactProtectedBytes(descriptors.avatarSource, sources.avatarSource);
  const audioKey = descriptor.seconds === 10 ? "soulx10s" : `soulx${descriptor.seconds}s`;
  if (!(["soulx2s", "soulx4s", "soulx6s", "soulx10s"] as const).includes(audioKey as never))
    throw new Error("V213_QUALIFICATION_PROTECTED_AUDIO_DESCRIPTOR_INVALID");
  const key = audioKey as "soulx2s" | "soulx4s" | "soulx6s" | "soulx10s";
  const rawAudio = exactProtectedBytes(descriptors[key], sources[key]);
  return { avatar, audio: buildV213SoulXQualificationWav(rawAudio, descriptor.seconds as never) };
}

function inputArtifact(
  role: "avatar_source" | "audio",
  descriptor: V213QualificationCaseDescriptor | V208SoulXWholeSpanDescriptor,
  bytes: Uint8Array<ArrayBuffer>,
): V213QualificationInputArtifact {
  const digest = sha256(bytes);
  const identity = digest.slice(7, 23);
  return Object.freeze({
    role,
    assetId: `v213-${role}-${identity}`,
    reservationId: `v213-${descriptor.key}-${role}-${identity}`,
    contentType: role === "avatar_source" ? "image/png" : "audio/wav",
    sha256: digest,
    bodyBase64: Buffer.from(bytes).toString("base64"),
  });
}

export interface V208DirectWholeSpanQualificationAdapter {
  readonly materializeWholeSpan: (input: {
    readonly descriptor: V208SoulXWholeSpanDescriptor;
    readonly deployment: V213LaneDeployment;
    readonly stageAuthorityId: string;
    readonly inputSha256: string;
  }) => Promise<V213QualificationCaseMaterialization>;
  readonly materializeQualificationCase: (input: {
    readonly descriptor: V213QualificationCaseDescriptor;
    readonly deployment: V213LaneDeployment;
    readonly stageAuthorityId: string;
    readonly inputSha256: string;
  }) => Promise<V213QualificationCaseMaterialization>;
  readonly cleanupMaterializedInputs: (input: {
    readonly materialization: V213QualificationCaseMaterialization;
    readonly terminalOutcome: "COMPLETED" | "FAILED" | "CANCELLED" | "TIMED_OUT";
  }) => Promise<{
    readonly originalRequestSha256: `sha256:${string}`;
    readonly evidence: Awaited<ReturnType<typeof cleanupV213QualificationInputs>>;
  }>;
  readonly cleanupAmbiguousMaterializedInputs: (
    materialization: V213QualificationCaseMaterialization,
  ) => Promise<true>;
  readonly cleanupOutputKeys: (keys: readonly string[]) => Promise<true>;
  /** Exact protected R2 read used only after the signed receipt binds an owned output authority. */
  readonly readOutput: (objectKey: string) => Promise<Uint8Array<ArrayBuffer>>;
}

/** Distinct V2-08 adapter. It preserves the V2-13 single-span factory byte-for-byte while staging
 * one avatar and all four approved audio spans into one signed whole-span worker request. */
export function createV208DirectWholeSpanQualificationAdapter(
  input: Parameters<typeof createV213DirectQualificationMaterializer>[0],
): V208DirectWholeSpanQualificationAdapter {
  if (input.operationId !== "soulx-live-qualification")
    throw new Error("V208_WHOLE_SPAN_OPERATION_INVALID");
  validateV213DirectQualificationInputs(input);
  const bucket = input.bucket ?? createV213DirectR2Bucket({ config: input.r2, fetch: input.fetch });
  const dependencies = createV213QualificationMaterializerDependencies({
    config: { r2: { ...input.r2, region: "auto" } } as never,
    bucket,
    signing: input.signing,
    store: createStore(input.database, input.signing.secretHex),
  });
  const materializerDependencies = {
    ...dependencies,
    ...(input.r2Signer === undefined ? {} : { r2Signer: input.r2Signer }),
    now: input.now,
    randomHex: input.randomHex,
  };
  const requests = new Map<
    string,
    ReturnType<typeof buildV213QualificationMaterializationRequest>
  >();
  const exactMaterialization = (materialization: V213QualificationCaseMaterialization) => {
    const request = requests.get(materialization.materializationEvidenceSha256);
    if (!request) throw new Error("V208_WHOLE_SPAN_MATERIALIZATION_NOT_OWNED");
    return request;
  };
  const objectKeys = (
    materialization: V213QualificationCaseMaterialization,
    role: "inputs" | "outputs",
  ) => {
    const request = materialization.request as Record<string, unknown>;
    if (role === "outputs") {
      const authorities = request.generated_output_authorities;
      if (!Array.isArray(authorities)) throw new Error("V208_OUTPUT_AUTHORITY_INVALID");
      return authorities.map((authority) => {
        const path = (authority as Record<string, unknown>).path;
        if (typeof path !== "string" || !path.startsWith("/tenant/") || path.includes(".."))
          throw new Error("V208_OUTPUT_AUTHORITY_INVALID");
        return path.slice(1);
      });
    }
    const ports = (request.ports as Record<string, unknown> | undefined)?.inputs;
    if (!Array.isArray(ports)) throw new Error("V208_INPUT_AUTHORITY_INVALID");
    return ports.map((authority) => {
      const path = (authority as Record<string, unknown>).path;
      if (typeof path !== "string" || !path.startsWith("/tenant/") || path.includes(".."))
        throw new Error("V208_INPUT_AUTHORITY_INVALID");
      return path.slice(1);
    });
  };
  const deleteAndProveAbsent = async (keys: readonly string[]) => {
    for (const key of [...keys].reverse()) {
      try {
        await bucket.delete(key);
      } catch {
        // Lost acknowledgements are accepted only when HEAD proves exact absence below.
      }
      if ((await bucket.head(key)) !== null) throw new Error("V208_DIRECT_R2_CLEANUP_AMBIGUOUS");
    }
    return true as const;
  };
  const adapter: V208DirectWholeSpanQualificationAdapter = {
    async materializeWholeSpan(materializationInput) {
      const descriptor = materializationInput.descriptor;
      const avatar = exactProtectedBytes(
        input.protectedInputDescriptors.avatarSource,
        input.protectedSourceBytes!.avatarSource,
      );
      const audioArtifacts = ([2, 4, 6, 10] as const).map((seconds) => {
        const key = `soulx${seconds}s` as const;
        const source = exactProtectedBytes(
          input.protectedInputDescriptors[key],
          input.protectedSourceBytes![key],
        );
        return inputArtifact("audio", descriptor, buildV213SoulXQualificationWav(source, seconds));
      });
      const request = buildV213QualificationMaterializationRequest({
        schemaVersion: "videoforge.v213-qualification-materialization-request/v1",
        fullLiveAuthorityId: input.fullLiveAuthorityId,
        operationId: input.operationId,
        stageAuthorityId: materializationInput.stageAuthorityId,
        outerStateSha256: input.outerStateSha256,
        inputSha256: materializationInput.inputSha256 as `sha256:${string}`,
        sourceCommit: input.sourceCommit,
        descriptor,
        caseSourceRef: input.sourceRefs.caseSource,
        generatorRef: input.sourceRefs.generators.soulx,
        validatorRef: input.sourceRefs.validators.soulx,
        deployment: materializationInput.deployment,
        inputs: [inputArtifact("avatar_source", descriptor, avatar), ...audioArtifacts],
      });
      const result = await materializeV213QualificationCase(request, materializerDependencies);
      requests.set(result.materialization.materializationEvidenceSha256, request);
      return result.materialization;
    },
    async materializeQualificationCase(materializationInput) {
      if (materializationInput.descriptor.lane !== "soulx")
        throw new Error("V208_QUALIFICATION_OPERATION_DESCRIPTOR_DRIFT");
      const { avatar, audio } = sourceForDescriptor(
        input.protectedInputDescriptors,
        input.protectedSourceBytes!,
        materializationInput.descriptor,
      );
      const request = buildV213QualificationMaterializationRequest({
        schemaVersion: "videoforge.v213-qualification-materialization-request/v1",
        fullLiveAuthorityId: input.fullLiveAuthorityId,
        operationId: input.operationId,
        stageAuthorityId: materializationInput.stageAuthorityId,
        outerStateSha256: input.outerStateSha256,
        inputSha256: materializationInput.inputSha256 as `sha256:${string}`,
        sourceCommit: input.sourceCommit,
        descriptor: materializationInput.descriptor,
        caseSourceRef: input.sourceRefs.caseSource,
        generatorRef: input.sourceRefs.generators.soulx,
        validatorRef: input.sourceRefs.validators.soulx,
        deployment: materializationInput.deployment,
        inputs: [
          inputArtifact("avatar_source", materializationInput.descriptor, avatar),
          inputArtifact("audio", materializationInput.descriptor, audio),
        ],
      });
      const result = await materializeV213QualificationCase(request, materializerDependencies);
      requests.set(result.materialization.materializationEvidenceSha256, request);
      return result.materialization;
    },
    async cleanupMaterializedInputs({ materialization, terminalOutcome }) {
      const request = exactMaterialization(materialization);
      const evidence = await cleanupV213QualificationInputs(request, { bucket, terminalOutcome });
      return { originalRequestSha256: request.requestSha256, evidence };
    },
    async cleanupAmbiguousMaterializedInputs(materialization) {
      exactMaterialization(materialization);
      return deleteAndProveAbsent(objectKeys(materialization, "inputs"));
    },
    cleanupOutputKeys: (keys) => deleteAndProveAbsent(keys),
    async readOutput(objectKey) {
      if (!objectKey.startsWith("tenant/") || objectKey.includes(".."))
        throw new Error("V208_OUTPUT_READBACK_KEY_INVALID");
      const value = await bucket.get(objectKey);
      if (value === null) throw new Error("V208_OUTPUT_READBACK_MISSING");
      const bytes = await value.arrayBuffer();
      if (bytes.byteLength !== value.size || bytes.byteLength === 0)
        throw new Error("V208_OUTPUT_READBACK_SIZE_INVALID");
      return new Uint8Array(bytes);
    },
  };
  return Object.freeze(adapter);
}

/**
 * Direct post-consumption child. It has no RunPod client and cannot dispatch. A result is returned
 * only after the DB claim, exact R2 CAS/readback, HMAC verification, persistence and DB readback.
 */
export function createV213DirectQualificationMaterializer(input: {
  readonly fullLiveAuthorityId: string;
  readonly operationId: "mage-live-qualification" | "soulx-live-qualification";
  readonly outerStateSha256: `sha256:${string}`;
  readonly sourceCommit: string;
  readonly sourceRefs: V213QualificationSourceRefs;
  readonly protectedInputDescriptors: V213QualificationProtectedInputDescriptors;
  readonly protectedSourceBytes?: V213QualificationProtectedSourceBytes;
  readonly r2: V213DirectQualificationR2Configuration;
  readonly signing: Readonly<{ readonly secretHex: string; readonly keyId: string }>;
  readonly database: TransactionalSqlExecutor;
  readonly bucket?: HostedR2BucketBinding;
  readonly r2Signer?: R2Signer;
  readonly fetch?: typeof fetch;
  readonly now?: () => Date;
  readonly randomHex?: (bytes: number) => string;
}): (materializationInput: {
  readonly descriptor: V213QualificationCaseDescriptor;
  readonly deployment: V213LaneDeployment;
  readonly stageAuthorityId: string;
  readonly inputSha256: string;
}) => Promise<V213QualificationCaseMaterialization> {
  validateV213DirectQualificationInputs(input);
  const bucket = input.bucket ?? createV213DirectR2Bucket({ config: input.r2, fetch: input.fetch });
  const dependencies = createV213QualificationMaterializerDependencies({
    config: {
      r2: { ...input.r2, region: "auto" },
    } as never,
    bucket,
    signing: input.signing,
    store: createStore(input.database, input.signing.secretHex),
  });
  const materializerDependencies = {
    ...dependencies,
    ...(input.r2Signer === undefined ? {} : { r2Signer: input.r2Signer }),
    now: input.now,
    randomHex: input.randomHex,
  };
  return async (materializationInput) => {
    if (
      materializationInput.descriptor.lane !==
      (input.operationId === "mage-live-qualification" ? "mage" : "soulx")
    )
      throw new Error("V213_QUALIFICATION_OPERATION_DESCRIPTOR_DRIFT");
    const inputs =
      materializationInput.descriptor.lane === "mage"
        ? []
        : (() => {
            const { avatar, audio } = sourceForDescriptor(
              input.protectedInputDescriptors,
              input.protectedSourceBytes!,
              materializationInput.descriptor,
            );
            return [
              inputArtifact("avatar_source", materializationInput.descriptor, avatar),
              inputArtifact("audio", materializationInput.descriptor, audio),
            ];
          })();
    const lane = materializationInput.descriptor.lane;
    const request = buildV213QualificationMaterializationRequest({
      schemaVersion: "videoforge.v213-qualification-materialization-request/v1",
      fullLiveAuthorityId: input.fullLiveAuthorityId,
      operationId: input.operationId,
      stageAuthorityId: materializationInput.stageAuthorityId,
      outerStateSha256: input.outerStateSha256,
      inputSha256: materializationInput.inputSha256 as `sha256:${string}`,
      sourceCommit: input.sourceCommit,
      descriptor: materializationInput.descriptor,
      caseSourceRef: input.sourceRefs.caseSource,
      generatorRef: input.sourceRefs.generators[lane],
      validatorRef: input.sourceRefs.validators[lane],
      deployment: materializationInput.deployment,
      inputs,
    });
    return (await materializeV213QualificationCase(request, materializerDependencies))
      .materialization;
  };
}
