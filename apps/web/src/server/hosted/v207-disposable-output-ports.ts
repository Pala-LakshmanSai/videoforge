import { canonicalizeJson } from "@videoforge/contracts/canonical-json";

import type { HostedR2BucketBinding } from "./configuration";
import { isExactHostedR2ObjectKey } from "./r2";

/**
 * Attempt69 uses a dedicated Worker and route.  It must never be mounted on the shared staging
 * Worker: the route and bucket are intentionally independent of the product runtime.
 */
export const V207_DISPOSABLE_OUTPUT_ROUTE = "/api/v2/v207/generated-output-port" as const;
export const V207_DISPOSABLE_OUTPUT_MAX_BYTES = 16 * 1024 * 1024;
export const V207_DISPOSABLE_OUTPUT_REQUEST_MAX_BYTES = 64 * 1024;
export const V207_DISPOSABLE_OUTPUT_PUT_MAX_LIFETIME_SECONDS = 7_200;
export const V207_DISPOSABLE_OUTPUT_GET_MAX_LIFETIME_SECONDS = 900;

const REQUEST_SCHEMA = "videoforge-v207-generated-output-port-request/v1" as const;
const PORT_SCHEMA = "videoforge-v207-generated-output-port/v1" as const;
const PUT_AUTHORITY_SCHEMA = "artifact-generated-output-authority/v1" as const;
const GET_AUTHORITY_SCHEMA = "artifact-transfer-port/v3" as const;
const RESERVATION_SCHEMA = "videoforge-v207-disposable-output-reservation/v1" as const;
const FINALIZE_SCHEMA = "videoforge-v207-generated-output-finalization/v1" as const;
const RECEIPT_SCHEMA = "artifact-commit-receipt/v3" as const;
const DELETE_SCHEMA = "videoforge-v207-generated-output-delete/v1" as const;
const CAPABILITY_SCHEMA = "videoforge-v207-disposable-output-capability/v1" as const;

const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/u;
const NONCE = /^[a-f0-9]{64}$/u;
const CAPABILITY = /^[a-f0-9]{64}$/u;
const CHECKSUM = /^sha256:[0-9a-f]{64}$/u;

type DisposableOperation = "PUT" | "GET" | "FINALIZE" | "DELETE";

export interface V207DisposableOutputEnvironment {
  readonly PRIVATE_ARTIFACTS?: HostedR2BucketBinding;
  readonly VIDEOFORGE_V207_AUTHORITY_NONCE?: string;
}

interface DisposableOutputReservation {
  readonly schema_version: typeof RESERVATION_SCHEMA;
  readonly reservation_id: string;
  readonly account_id: string;
  readonly workspace_id: string;
  readonly object_key: string;
  readonly path: string;
  readonly content_type: "image/png";
  readonly max_content_length: number;
  readonly expires_at: string;
  readonly max_uses: 1;
  readonly put_capability_handle: string;
  readonly finalize_capability_handle: string;
  readonly get_claim_keys: readonly string[];
  readonly provenance_key: string;
  readonly receipt_key: string;
  readonly created_at: string;
}

interface DisposableOutputReceipt {
  readonly schema_version: typeof RECEIPT_SCHEMA;
  readonly receipt_id: string;
  readonly reservation_id: string;
  readonly account_id: string;
  readonly workspace_id: string;
  readonly object_key: string;
  readonly callback_id: string;
  readonly content_type: "image/png";
  readonly content_length: number;
  readonly checksum_sha256: string;
  readonly probe: {
    readonly width: 1280;
    readonly height: 720;
    readonly format: "png";
    readonly decoded: true;
    readonly source: "V207_R2_FINALIZE_PNG_PROBE";
  };
  readonly retention_class: "PROJECT";
  readonly retain_until: null;
  readonly committed_at: string;
  readonly receipt_sha256: string;
}

function responseJson(value: unknown, status = 200): Response {
  return Response.json(value, {
    status,
    headers: {
      "cache-control": "no-store",
      "content-security-policy": "default-src 'none'; frame-ancestors 'none'",
      "x-content-type-options": "nosniff",
      "x-videoforge-runtime": "v207-disposable-output",
    },
  });
}

function errorResponse(code: string, status: number): Response {
  return responseJson({ error: { code } }, status);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function exactKeys(value: Record<string, unknown>, operation: DisposableOperation): boolean {
  const expected =
    operation === "PUT"
      ? [
          "account_id",
          "content_type",
          "lifetime_seconds",
          "max_content_length",
          "object_key",
          "operation",
          "schema_version",
          "workspace_id",
        ]
      : operation === "GET"
        ? [
            "account_id",
            "checksum_sha256",
            "content_length",
            "content_type",
            "lifetime_seconds",
            "max_content_length",
            "object_key",
            "operation",
            "schema_version",
            "workspace_id",
          ]
        : operation === "FINALIZE"
          ? [
              "account_id",
              "callback_id",
              "capability_handle",
              "checksum_sha256",
              "content_length",
              "content_type",
              "object_key",
              "operation",
              "reservation_id",
              "schema_version",
              "workspace_id",
            ]
          : [
              "account_id",
              "object_key",
              "operation",
              "rollback_token",
              "schema_version",
              "workspace_id",
            ];
  return Object.keys(value).sort().join(",") === expected.sort().join(",");
}

function constantTimeEqual(left: string, right: string): boolean {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) {
    difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return difference === 0;
}

function canonicalBytes(value: unknown): ArrayBuffer {
  return new TextEncoder().encode(canonicalizeJson(value)).buffer as ArrayBuffer;
}

async function sha256Hex(value: string | Uint8Array): Promise<string> {
  const bytes = typeof value === "string" ? new TextEncoder().encode(value) : value.slice();
  const digest = new Uint8Array(
    await crypto.subtle.digest("SHA-256", bytes.slice().buffer as ArrayBuffer),
  );
  return [...digest].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function hmacHex(nonce: string, value: unknown): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(nonce),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = new Uint8Array(
    await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(canonicalizeJson(value))),
  );
  return [...signature].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function rawHmacHex(nonce: string, value: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(nonce),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = new Uint8Array(
    await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(value)),
  );
  return [...signature].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function exactOutputKey(value: string, accountId: string, workspaceId: string): boolean {
  if (!isExactHostedR2ObjectKey(value)) return false;
  const parts = value.split("/");
  return (
    parts.length === 14 &&
    parts[0] === "tenant" &&
    parts[1] === accountId &&
    ID.test(parts[1] ?? "") &&
    parts[2] === "workspace" &&
    parts[3] === workspaceId &&
    ID.test(parts[3] ?? "") &&
    parts[4] === "project" &&
    ID.test(parts[5] ?? "") &&
    parts[6] === "revision" &&
    ID.test(parts[7] ?? "") &&
    parts[8] === "lane" &&
    parts[9] === "mage-image" &&
    parts[10] === "job" &&
    ID.test(parts[11] ?? "") &&
    parts[12] === "artifact" &&
    ID.test(parts[13] ?? "")
  );
}

function provenanceKeys(objectKey: string): { reservationKey: string; receiptKey: string } {
  const parts = objectKey.split("/");
  if (
    parts.length !== 14 ||
    parts[0] !== "tenant" ||
    parts[2] !== "workspace" ||
    parts[4] !== "project" ||
    parts[6] !== "revision" ||
    parts[8] !== "lane" ||
    parts[9] !== "mage-image" ||
    parts[10] !== "job" ||
    parts[12] !== "artifact"
  ) {
    throw new Error("V207_OUTPUT_KEY_INVALID");
  }
  const base = [
    parts[0],
    parts[1],
    parts[2],
    parts[3],
    parts[4],
    parts[5],
    parts[6],
    parts[7],
    "lane",
    "provenance",
    "job",
    parts[11],
    "artifact",
  ].join("/");
  const stem = parts[13];
  const reservationKey = `${base}/${stem}.generated-output-reservation`;
  const receiptKey = `${base}/${stem}.artifact-commit-receipt-v3`;
  if (!isExactHostedR2ObjectKey(reservationKey) || !isExactHostedR2ObjectKey(receiptKey)) {
    throw new Error("V207_PROVENANCE_KEY_INVALID");
  }
  return { reservationKey, receiptKey };
}

function capabilityBody(
  operation: DisposableOperation,
  reservation: Pick<
    DisposableOutputReservation,
    "reservation_id" | "account_id" | "workspace_id" | "object_key" | "max_content_length"
  >,
): Record<string, unknown> {
  const base = {
    schema_version: CAPABILITY_SCHEMA,
    reservation_id: reservation.reservation_id,
    account_id: reservation.account_id,
    workspace_id: reservation.workspace_id,
    object_key: reservation.object_key,
    content_type: "image/png" as const,
    max_uses: 1 as const,
  };
  return operation === "PUT"
    ? { ...base, operation: "PUT" as const, max_content_length: reservation.max_content_length }
    : { ...base, operation };
}

async function capabilityHandle(
  nonce: string,
  operation: DisposableOperation,
  reservation: Pick<
    DisposableOutputReservation,
    "reservation_id" | "account_id" | "workspace_id" | "object_key" | "max_content_length"
  >,
): Promise<string> {
  return hmacHex(nonce, capabilityBody(operation, reservation));
}

async function getCapabilityHandle(
  nonce: string,
  reservation: DisposableOutputReservation,
  transferId: string,
  contentLength: number,
  checksumSha256: string,
  expiresAt: string,
): Promise<string> {
  return hmacHex(nonce, {
    ...capabilityBody("GET", reservation),
    transfer_id: transferId,
    content_length: contentLength,
    checksum_sha256: checksumSha256,
    expires_at: expiresAt,
  });
}

async function readStoredJson(
  bucket: HostedR2BucketBinding,
  key: string,
): Promise<Record<string, unknown> | null> {
  const object = await bucket.get(key);
  if (object === null) return null;
  if (!Number.isSafeInteger(object.size) || object.size < 1 || object.size > 64 * 1024) {
    throw new Error("V207_PROVENANCE_RECORD_INVALID");
  }
  try {
    const parsed: unknown = JSON.parse(
      new TextDecoder().decode(new Uint8Array(await object.arrayBuffer())),
    );
    if (!isRecord(parsed)) throw new Error("V207_PROVENANCE_RECORD_INVALID");
    return parsed;
  } catch {
    throw new Error("V207_PROVENANCE_RECORD_INVALID");
  }
}

function reservationShape(
  value: Record<string, unknown>,
): value is Record<string, unknown> & DisposableOutputReservation {
  const keys = [
    "account_id",
    "content_type",
    "created_at",
    "expires_at",
    "finalize_capability_handle",
    "get_claim_keys",
    "max_content_length",
    "max_uses",
    "object_key",
    "path",
    "provenance_key",
    "receipt_key",
    "put_capability_handle",
    "reservation_id",
    "schema_version",
    "workspace_id",
  ];
  return (
    Object.keys(value).sort().join(",") === keys.sort().join(",") &&
    value.schema_version === RESERVATION_SCHEMA &&
    typeof value.reservation_id === "string" &&
    ID.test(value.reservation_id) &&
    typeof value.account_id === "string" &&
    ID.test(value.account_id) &&
    typeof value.workspace_id === "string" &&
    ID.test(value.workspace_id) &&
    typeof value.object_key === "string" &&
    exactOutputKey(value.object_key, value.account_id, value.workspace_id) &&
    value.path === `/${value.object_key}` &&
    value.content_type === "image/png" &&
    typeof value.max_content_length === "number" &&
    Number.isSafeInteger(value.max_content_length) &&
    value.max_content_length > 0 &&
    value.max_content_length <= V207_DISPOSABLE_OUTPUT_MAX_BYTES &&
    typeof value.expires_at === "string" &&
    Number.isFinite(Date.parse(value.expires_at)) &&
    value.max_uses === 1 &&
    typeof value.created_at === "string" &&
    Number.isFinite(Date.parse(value.created_at)) &&
    typeof value.provenance_key === "string" &&
    typeof value.receipt_key === "string" &&
    isExactHostedR2ObjectKey(value.provenance_key) &&
    isExactHostedR2ObjectKey(value.receipt_key) &&
    typeof value.put_capability_handle === "string" &&
    CAPABILITY.test(value.put_capability_handle) &&
    Array.isArray(value.get_claim_keys) &&
    value.get_claim_keys.length <= 4 &&
    value.get_claim_keys.every((key) => typeof key === "string" && isExactHostedR2ObjectKey(key)) &&
    typeof value.finalize_capability_handle === "string" &&
    CAPABILITY.test(value.finalize_capability_handle)
  );
}

function receiptShape(
  value: Record<string, unknown>,
): value is Record<string, unknown> & DisposableOutputReceipt {
  const probe = value.probe;
  return (
    value.schema_version === RECEIPT_SCHEMA &&
    typeof value.receipt_id === "string" &&
    ID.test(value.receipt_id) &&
    typeof value.reservation_id === "string" &&
    ID.test(value.reservation_id) &&
    typeof value.account_id === "string" &&
    ID.test(value.account_id) &&
    typeof value.workspace_id === "string" &&
    ID.test(value.workspace_id) &&
    typeof value.object_key === "string" &&
    typeof value.callback_id === "string" &&
    ID.test(value.callback_id) &&
    value.content_type === "image/png" &&
    typeof value.content_length === "number" &&
    Number.isSafeInteger(value.content_length) &&
    value.content_length > 0 &&
    value.content_length <= V207_DISPOSABLE_OUTPUT_MAX_BYTES &&
    typeof value.checksum_sha256 === "string" &&
    CHECKSUM.test(value.checksum_sha256) &&
    isRecord(probe) &&
    probe.width === 1280 &&
    probe.height === 720 &&
    probe.format === "png" &&
    probe.decoded === true &&
    probe.source === "V207_R2_FINALIZE_PNG_PROBE" &&
    value.retention_class === "PROJECT" &&
    value.retain_until === null &&
    typeof value.committed_at === "string" &&
    Number.isFinite(Date.parse(value.committed_at)) &&
    typeof value.receipt_sha256 === "string" &&
    CHECKSUM.test(value.receipt_sha256)
  );
}

async function receiptHashValid(receipt: DisposableOutputReceipt): Promise<boolean> {
  const body = { ...receipt } as Record<string, unknown>;
  const expected = body.receipt_sha256;
  delete body.schema_version;
  delete body.receipt_id;
  delete body.receipt_sha256;
  return expected === `sha256:${await sha256Hex(canonicalizeJson(body))}`;
}

const PNG_CRC32_TABLE = new Uint32Array(256);
for (let index = 0; index < PNG_CRC32_TABLE.length; index += 1) {
  let crc = index;
  for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  PNG_CRC32_TABLE[index] = crc >>> 0;
}

function pngCrc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = (crc >>> 8) ^ PNG_CRC32_TABLE[(crc ^ byte) & 0xff]!;
  return (crc ^ 0xffffffff) >>> 0;
}

async function inflateScanlines(
  compressedParts: readonly Uint8Array[],
  expectedLength: number,
): Promise<Uint8Array | null> {
  try {
    const compressed = new Uint8Array(
      compressedParts.reduce((total, part) => total + part.byteLength, 0),
    );
    let offset = 0;
    for (const part of compressedParts) {
      compressed.set(part, offset);
      offset += part.byteLength;
    }
    const body = new Response(compressed.slice().buffer).body;
    if (body === null) return null;
    const reader = body.pipeThrough(new DecompressionStream("deflate")).getReader();
    const inflated = new Uint8Array(expectedLength);
    let written = 0;
    while (true) {
      const result = await reader.read();
      if (result.done) break;
      if (written + result.value.byteLength > expectedLength) {
        await reader.cancel();
        return null;
      }
      inflated.set(result.value, written);
      written += result.value.byteLength;
    }
    return written === expectedLength ? inflated : null;
  } catch {
    return null;
  }
}

/** Validate the fixed 1280x720 PNG contract before a receipt can be persisted. */
export async function probeV207QualificationPng(
  bytes: Uint8Array,
): Promise<DisposableOutputReceipt["probe"] | null> {
  if (bytes.byteLength < 57 || bytes.byteLength > V207_DISPOSABLE_OUTPUT_MAX_BYTES) return null;
  const signature = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  if (signature.some((byte, index) => bytes[index] !== byte)) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const idatParts: Uint8Array[] = [];
  let offset = 8;
  let sawHeader = false;
  let sawEnd = false;
  let bytesPerPixel = 0;
  while (offset + 12 <= bytes.byteLength) {
    const length = view.getUint32(offset);
    const dataStart = offset + 8;
    const dataEnd = dataStart + length;
    if (dataEnd + 4 > bytes.byteLength) return null;
    const type = new TextDecoder().decode(bytes.subarray(offset + 4, offset + 8));
    if (pngCrc32(bytes.subarray(offset + 4, dataEnd)) !== view.getUint32(dataEnd)) return null;
    if (!sawHeader) {
      if (type !== "IHDR" || length !== 13 || offset !== 8) return null;
      const width = view.getUint32(dataStart);
      const height = view.getUint32(dataStart + 4);
      const bitDepth = bytes[dataStart + 8];
      const colorType = bytes[dataStart + 9];
      if (
        width !== 1280 ||
        height !== 720 ||
        bitDepth !== 8 ||
        (colorType !== 2 && colorType !== 6) ||
        bytes[dataStart + 10] !== 0 ||
        bytes[dataStart + 11] !== 0 ||
        bytes[dataStart + 12] !== 0
      ) {
        return null;
      }
      bytesPerPixel = colorType === 6 ? 4 : 3;
      sawHeader = true;
    } else if (type === "IHDR") {
      return null;
    }
    if (type === "IDAT") {
      if (sawEnd || length === 0) return null;
      idatParts.push(bytes.slice(dataStart, dataEnd));
    } else if (type === "IEND") {
      if (length !== 0 || idatParts.length === 0) return null;
      sawEnd = true;
      offset = dataEnd + 4;
      break;
    }
    offset = dataEnd + 4;
  }
  if (!sawHeader || !sawEnd || offset !== bytes.byteLength || bytesPerPixel === 0) return null;
  const rowLength = 1 + 1280 * bytesPerPixel;
  const inflated = await inflateScanlines(idatParts, rowLength * 720);
  if (inflated === null) return null;
  for (let row = 0; row < 720; row += 1) {
    const filter = inflated[row * rowLength];
    if (filter === undefined || filter > 4) return null;
  }
  return {
    width: 1280,
    height: 720,
    format: "png",
    decoded: true,
    source: "V207_R2_FINALIZE_PNG_PROBE",
  };
}

async function readRequestJson(request: Request): Promise<unknown | null> {
  const declared = request.headers.get("content-length");
  if (
    declared !== null &&
    (!/^\d+$/u.test(declared) || Number(declared) > V207_DISPOSABLE_OUTPUT_REQUEST_MAX_BYTES)
  ) {
    return null;
  }
  const body = await request.text();
  if (new TextEncoder().encode(body).byteLength > V207_DISPOSABLE_OUTPUT_REQUEST_MAX_BYTES)
    return null;
  try {
    return JSON.parse(body) as unknown;
  } catch {
    return null;
  }
}

async function readBoundedBody(
  request: Request,
  maximumBytes: number,
): Promise<ArrayBuffer | null> {
  if (request.body === null) return new ArrayBuffer(0);
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > maximumBytes) {
        await reader.cancel();
        return null;
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const body = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body.buffer;
}

function imageContentTypeMetadataValid(contentType: string | undefined): boolean {
  return contentType === undefined || contentType === "image/png";
}

function requestScopeValid(value: Record<string, unknown>): boolean {
  return (
    value.schema_version === REQUEST_SCHEMA &&
    typeof value.account_id === "string" &&
    ID.test(value.account_id) &&
    typeof value.workspace_id === "string" &&
    ID.test(value.workspace_id) &&
    typeof value.object_key === "string" &&
    exactOutputKey(value.object_key, value.account_id, value.workspace_id) &&
    (value.operation === "DELETE" || value.content_type === "image/png")
  );
}

function lifetimeValid(value: unknown, maximum: number): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 1 && value <= maximum;
}

function lengthValid(value: unknown, maximum = V207_DISPOSABLE_OUTPUT_MAX_BYTES): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 1 && value <= maximum;
}

async function buildReservation(
  nonce: string,
  value: Record<string, unknown>,
  now: Date,
  keys: { reservationKey: string; receiptKey: string },
): Promise<DisposableOutputReservation> {
  const objectKey = value.object_key as string;
  const maxContentLength = value.max_content_length as number;
  const reservationId = `gen_${await sha256Hex(`videoforge-v207-disposable:${nonce}:${objectKey}`)}`;
  const base = {
    reservation_id: reservationId,
    account_id: value.account_id as string,
    workspace_id: value.workspace_id as string,
    object_key: objectKey,
    max_content_length: maxContentLength,
  } as const;
  return {
    schema_version: RESERVATION_SCHEMA,
    ...base,
    path: `/${objectKey}`,
    content_type: "image/png",
    expires_at: new Date(now.getTime() + (value.lifetime_seconds as number) * 1_000).toISOString(),
    max_uses: 1,
    put_capability_handle: await capabilityHandle(nonce, "PUT", base),
    finalize_capability_handle: await capabilityHandle(nonce, "FINALIZE", base),
    get_claim_keys: [],
    provenance_key: keys.reservationKey,
    receipt_key: keys.receiptKey,
    created_at: now.toISOString(),
  };
}

function sameReservation(
  stored: DisposableOutputReservation,
  requested: DisposableOutputReservation,
): boolean {
  return (
    stored.reservation_id === requested.reservation_id &&
    stored.account_id === requested.account_id &&
    stored.workspace_id === requested.workspace_id &&
    stored.object_key === requested.object_key &&
    stored.path === requested.path &&
    stored.content_type === requested.content_type &&
    stored.max_content_length === requested.max_content_length &&
    stored.max_uses === requested.max_uses &&
    stored.provenance_key === requested.provenance_key &&
    stored.receipt_key === requested.receipt_key
  );
}

function putAuthority(reservation: DisposableOutputReservation): {
  readonly schema_version: typeof PUT_AUTHORITY_SCHEMA;
  readonly reservation_id: string;
  readonly account_id: string;
  readonly workspace_id: string;
  readonly method: "PUT";
  readonly path: string;
  readonly content_type: "image/png";
  readonly max_content_length: number;
  readonly expires_at: string;
  readonly max_uses: 1;
  readonly capability_handle: string;
} {
  return {
    schema_version: PUT_AUTHORITY_SCHEMA,
    reservation_id: reservation.reservation_id,
    account_id: reservation.account_id,
    workspace_id: reservation.workspace_id,
    content_type: "image/png",
    max_content_length: reservation.max_content_length,
    max_uses: 1,
    method: "PUT",
    path: reservation.path,
    expires_at: reservation.expires_at,
    capability_handle: reservation.finalize_capability_handle,
  };
}

async function makeReceipt(
  reservation: DisposableOutputReservation,
  callbackId: string,
  bytes: Uint8Array,
  checksum: string,
  probe: DisposableOutputReceipt["probe"],
): Promise<DisposableOutputReceipt> {
  const body = {
    reservation_id: reservation.reservation_id,
    account_id: reservation.account_id,
    workspace_id: reservation.workspace_id,
    object_key: reservation.object_key,
    callback_id: callbackId,
    content_type: "image/png" as const,
    content_length: bytes.byteLength,
    checksum_sha256: checksum,
    probe,
    retention_class: "PROJECT" as const,
    retain_until: null,
    committed_at: new Date().toISOString(),
  };
  const receiptSha256 = `sha256:${await sha256Hex(canonicalizeJson(body))}`;
  return {
    schema_version: RECEIPT_SCHEMA,
    receipt_id: `receipt_${receiptSha256.slice("sha256:".length, 47)}`,
    ...body,
    receipt_sha256: receiptSha256,
  };
}

async function handlePut(
  nonce: string,
  value: Record<string, unknown>,
  bucket: HostedR2BucketBinding,
  requestUrl: URL,
): Promise<Response> {
  if (
    !lengthValid(value.max_content_length) ||
    !lifetimeValid(value.lifetime_seconds, V207_DISPOSABLE_OUTPUT_PUT_MAX_LIFETIME_SECONDS)
  ) {
    return errorResponse("V207_REQUEST_INVALID", 400);
  }
  const keys = provenanceKeys(value.object_key as string);
  const now = new Date();
  const requested = await buildReservation(nonce, value, now, keys);
  const existing = await readStoredJson(bucket, keys.reservationKey);
  let reservation = requested;
  if (existing !== null) {
    if (!reservationShape(existing)) return errorResponse("V207_RESERVATION_CONFLICT", 409);
    reservation = existing;
    if (!sameReservation(existing, requested))
      return errorResponse("V207_RESERVATION_CONFLICT", 409);
    if (Date.parse(existing.expires_at) <= now.getTime()) {
      return errorResponse("V207_RESERVATION_EXPIRED", 409);
    }
  } else {
    await bucket.put(keys.reservationKey, canonicalBytes(requested), {
      httpMetadata: { contentType: "application/json" },
    });
  }
  const putUrl = new URL(requestUrl);
  putUrl.search = "";
  putUrl.searchParams.set("operation", "PUT");
  putUrl.searchParams.set("reservation_id", reservation.reservation_id);
  putUrl.searchParams.set("object_key", reservation.object_key);
  putUrl.searchParams.set("capability_handle", reservation.put_capability_handle);
  const remainingSeconds = Math.max(
    1,
    Math.min(
      V207_DISPOSABLE_OUTPUT_PUT_MAX_LIFETIME_SECONDS,
      Math.ceil((Date.parse(reservation.expires_at) - now.getTime()) / 1_000),
    ),
  );
  return responseJson({
    schema_version: PORT_SCHEMA,
    operation: "PUT",
    method: "PUT",
    url: putUrl.toString(),
    requiredHeaders: { "content-type": "image/png" },
    expiresAt: reservation.expires_at,
    contentType: "image/png",
    maxContentLength: reservation.max_content_length,
    lifetimeSeconds: remainingSeconds,
    authority: putAuthority(reservation),
  });
}

async function loadReservation(
  value: Record<string, unknown>,
  bucket: HostedR2BucketBinding,
): Promise<DisposableOutputReservation | null> {
  const keys = provenanceKeys(value.object_key as string);
  const stored = await readStoredJson(bucket, keys.reservationKey);
  if (stored === null || !reservationShape(stored)) return null;
  if (
    stored.account_id !== value.account_id ||
    stored.workspace_id !== value.workspace_id ||
    stored.object_key !== value.object_key ||
    stored.reservation_id !== value.reservation_id ||
    stored.provenance_key !== keys.reservationKey ||
    stored.receipt_key !== keys.receiptKey
  ) {
    return null;
  }
  return stored;
}

async function loadReservationByObject(
  value: Record<string, unknown>,
  bucket: HostedR2BucketBinding,
): Promise<DisposableOutputReservation | null> {
  const keys = provenanceKeys(value.object_key as string);
  const stored = await readStoredJson(bucket, keys.reservationKey);
  if (stored === null || !reservationShape(stored)) return null;
  if (
    stored.account_id !== value.account_id ||
    stored.workspace_id !== value.workspace_id ||
    stored.object_key !== value.object_key ||
    stored.provenance_key !== keys.reservationKey ||
    stored.receipt_key !== keys.receiptKey
  ) {
    return null;
  }
  return stored;
}

async function handleGet(
  nonce: string,
  value: Record<string, unknown>,
  bucket: HostedR2BucketBinding,
  requestUrl: URL,
): Promise<Response> {
  if (
    !lengthValid(value.content_length) ||
    !lifetimeValid(value.lifetime_seconds, V207_DISPOSABLE_OUTPUT_GET_MAX_LIFETIME_SECONDS) ||
    typeof value.checksum_sha256 !== "string" ||
    !CHECKSUM.test(value.checksum_sha256)
  ) {
    return errorResponse("V207_REQUEST_INVALID", 400);
  }
  const reservation = await loadReservationByObject(value, bucket);
  if (reservation === null) return errorResponse("V207_RESERVATION_NOT_FOUND", 404);
  const head = await bucket.head(reservation.object_key);
  if (
    head === null ||
    head.size !== value.content_length ||
    !imageContentTypeMetadataValid(head.httpMetadata?.contentType)
  ) {
    return errorResponse("V207_OUTPUT_NOT_FOUND", 404);
  }
  const transferId = `get_${crypto.randomUUID()}`;
  const claimKey = `${reservation.receipt_key}.get-claim-${await sha256Hex(transferId)}`;
  if (!isExactHostedR2ObjectKey(claimKey) || reservation.get_claim_keys.length >= 4) {
    return errorResponse("V207_GET_CLAIM_LIMIT", 409);
  }
  const updatedReservation: DisposableOutputReservation = {
    ...reservation,
    get_claim_keys: [...reservation.get_claim_keys, claimKey],
  };
  await bucket.put(reservation.provenance_key, canonicalBytes(updatedReservation), {
    httpMetadata: { contentType: "application/json" },
  });
  const expiresAt = new Date(Date.now() + (value.lifetime_seconds as number) * 1_000).toISOString();
  const getCapability = await getCapabilityHandle(
    nonce,
    updatedReservation,
    transferId,
    value.content_length as number,
    value.checksum_sha256 as string,
    expiresAt,
  );
  const getUrl = new URL(requestUrl);
  getUrl.search = "";
  getUrl.searchParams.set("operation", "GET");
  getUrl.searchParams.set("reservation_id", reservation.reservation_id);
  getUrl.searchParams.set("transfer_id", transferId);
  getUrl.searchParams.set("claim_key", claimKey);
  getUrl.searchParams.set("object_key", reservation.object_key);
  getUrl.searchParams.set("content_length", String(value.content_length));
  getUrl.searchParams.set("checksum_sha256", value.checksum_sha256 as string);
  getUrl.searchParams.set("expires_at", expiresAt);
  getUrl.searchParams.set("capability_handle", getCapability);
  const authority = {
    schema_version: GET_AUTHORITY_SCHEMA,
    operation: "GET" as const,
    reservation_id: transferId,
    account_id: reservation.account_id,
    workspace_id: reservation.workspace_id,
    object_key: reservation.object_key,
    method: "GET" as const,
    path: `/${reservation.object_key}`,
    content_type: "image/png" as const,
    content_length: value.content_length as number,
    checksum_sha256: value.checksum_sha256 as string,
    expires_at: expiresAt,
    max_uses: 1 as const,
    capability_handle: getCapability,
  };
  return responseJson({
    schema_version: PORT_SCHEMA,
    operation: "GET",
    method: "GET",
    url: getUrl.toString(),
    requiredHeaders: {},
    expiresAt,
    contentType: "image/png",
    contentLength: value.content_length,
    checksumSha256: value.checksum_sha256,
    authority,
  });
}

async function handleFinalize(
  nonce: string,
  value: Record<string, unknown>,
  bucket: HostedR2BucketBinding,
): Promise<Response> {
  if (
    !CAPABILITY.test(String(value.capability_handle)) ||
    !ID.test(String(value.reservation_id)) ||
    !ID.test(String(value.callback_id)) ||
    !lengthValid(value.content_length) ||
    typeof value.checksum_sha256 !== "string" ||
    !CHECKSUM.test(value.checksum_sha256)
  ) {
    return errorResponse("V207_REQUEST_INVALID", 400);
  }
  const reservation = await loadReservation(value, bucket);
  if (reservation === null) return errorResponse("V207_RESERVATION_NOT_FOUND", 404);
  const expected = await capabilityHandle(nonce, "FINALIZE", reservation);
  if (!constantTimeEqual(expected, value.capability_handle as string)) {
    return errorResponse("V207_CAPABILITY_REJECTED", 403);
  }
  const object = await bucket.get(reservation.object_key);
  if (object === null) return errorResponse("V207_OUTPUT_NOT_FOUND", 404);
  if (
    !Number.isSafeInteger(object.size) ||
    object.size < 1 ||
    object.size > V207_DISPOSABLE_OUTPUT_MAX_BYTES ||
    object.size > reservation.max_content_length ||
    !imageContentTypeMetadataValid(object.httpMetadata?.contentType)
  ) {
    return errorResponse("V207_OUTPUT_FACTS_MISMATCH", 409);
  }
  const bytes = new Uint8Array(await object.arrayBuffer());
  if (
    bytes.byteLength !== object.size ||
    bytes.byteLength !== value.content_length ||
    value.content_type !== "image/png"
  ) {
    return errorResponse("V207_OUTPUT_FACTS_MISMATCH", 409);
  }
  const checksum = `sha256:${await sha256Hex(bytes)}`;
  if (checksum !== value.checksum_sha256) return errorResponse("V207_OUTPUT_FACTS_MISMATCH", 409);
  const existingValue = await readStoredJson(bucket, reservation.receipt_key);
  if (existingValue !== null) {
    if (
      !receiptShape(existingValue) ||
      !(await receiptHashValid(existingValue)) ||
      existingValue.reservation_id !== reservation.reservation_id ||
      existingValue.account_id !== reservation.account_id ||
      existingValue.workspace_id !== reservation.workspace_id ||
      existingValue.object_key !== reservation.object_key ||
      existingValue.callback_id !== value.callback_id ||
      existingValue.content_length !== bytes.byteLength ||
      existingValue.checksum_sha256 !== checksum
    ) {
      return errorResponse("V207_RECEIPT_CONFLICT", 409);
    }
    return responseJson({
      schema_version: FINALIZE_SCHEMA,
      receipt: existingValue,
      idempotent: true,
    });
  }
  if (Date.parse(reservation.expires_at) <= Date.now()) {
    return errorResponse("V207_RESERVATION_EXPIRED", 409);
  }
  const probe = await probeV207QualificationPng(bytes);
  if (probe === null) return errorResponse("V207_OUTPUT_PNG_PROBE_FAILED", 409);
  const receipt = await makeReceipt(
    reservation,
    value.callback_id as string,
    bytes,
    checksum,
    probe,
  );
  await bucket.put(reservation.receipt_key, canonicalBytes(receipt), {
    httpMetadata: { contentType: "application/json" },
  });
  return responseJson({ schema_version: FINALIZE_SCHEMA, receipt, idempotent: false });
}

async function deleteExact(
  bucket: HostedR2BucketBinding,
  keys: readonly string[],
): Promise<boolean> {
  for (const key of keys) await bucket.delete(key);
  for (const key of keys) if ((await bucket.head(key)) !== null) return false;
  return true;
}

async function handleDelete(
  nonce: string,
  value: Record<string, unknown>,
  bucket: HostedR2BucketBinding,
): Promise<Response> {
  if (typeof value.rollback_token !== "string" || !CAPABILITY.test(value.rollback_token)) {
    return errorResponse("V207_REQUEST_INVALID", 400);
  }
  const expectedRollbackToken = await rawHmacHex(nonce, value.object_key as string);
  if (!constantTimeEqual(expectedRollbackToken, value.rollback_token)) {
    return errorResponse("V207_CAPABILITY_REJECTED", 403);
  }
  const keys = provenanceKeys(value.object_key as string);
  const reservation = await loadReservationByObject(value, bucket);
  const deleted = await deleteExact(bucket, [
    value.object_key as string,
    keys.reservationKey,
    keys.receiptKey,
    ...(reservation?.get_claim_keys ?? []),
  ]);
  if (!deleted) return errorResponse("V207_DELETE_UNCONFIRMED", 503);
  return responseJson({
    schema_version: DELETE_SCHEMA,
    operation: "DELETE",
    deleted: true,
    idempotent: reservation === null,
  });
}

function exactQuery(url: URL, names: readonly string[]): boolean {
  const actual = [...url.searchParams.keys()].sort();
  const expected = [...names].sort();
  return (
    actual.length === expected.length &&
    actual.every((name, index) => name === expected[index]) &&
    names.every((name) => url.searchParams.getAll(name).length === 1)
  );
}

async function loadCapabilityReservation(
  url: URL,
  bucket: HostedR2BucketBinding,
): Promise<DisposableOutputReservation | null> {
  const objectKey = url.searchParams.get("object_key") ?? "";
  const reservationId = url.searchParams.get("reservation_id") ?? "";
  if (!isExactHostedR2ObjectKey(objectKey) || !ID.test(reservationId)) return null;
  let keys: { reservationKey: string; receiptKey: string };
  try {
    keys = provenanceKeys(objectKey);
  } catch {
    return null;
  }
  const stored = await readStoredJson(bucket, keys.reservationKey);
  if (
    stored === null ||
    !reservationShape(stored) ||
    stored.object_key !== objectKey ||
    stored.reservation_id !== reservationId ||
    stored.provenance_key !== keys.reservationKey
  ) {
    return null;
  }
  return stored;
}

async function handleCapabilityTransfer(
  request: Request,
  url: URL,
  nonce: string,
  bucket: HostedR2BucketBinding,
): Promise<Response> {
  const operation = url.searchParams.get("operation");
  if (request.method === "PUT" && operation === "PUT") {
    if (!exactQuery(url, ["capability_handle", "object_key", "operation", "reservation_id"])) {
      return errorResponse("V207_CAPABILITY_INVALID", 400);
    }
    const reservation = await loadCapabilityReservation(url, bucket);
    const presented = url.searchParams.get("capability_handle") ?? "";
    if (
      reservation === null ||
      !CAPABILITY.test(presented) ||
      !constantTimeEqual(reservation.put_capability_handle, presented)
    ) {
      return errorResponse("V207_CAPABILITY_REJECTED", 403);
    }
    if (Date.parse(reservation.expires_at) <= Date.now()) {
      return errorResponse("V207_RESERVATION_EXPIRED", 409);
    }
    const declared = request.headers.get("content-length");
    let declaredLength: number | null = null;
    if (declared !== null) {
      if (!/^[1-9][0-9]*$/u.test(declared)) {
        return errorResponse("V207_OUTPUT_FACTS_MISMATCH", 400);
      }
      const parsed = Number(declared);
      if (
        !Number.isSafeInteger(parsed) ||
        String(parsed) !== declared ||
        !lengthValid(parsed, reservation.max_content_length)
      ) {
        return errorResponse("V207_OUTPUT_FACTS_MISMATCH", 400);
      }
      declaredLength = parsed;
    }
    if (request.headers.get("content-type") !== "image/png") {
      return errorResponse("V207_OUTPUT_FACTS_MISMATCH", 400);
    }
    let existing: Awaited<ReturnType<HostedR2BucketBinding["head"]>>;
    try {
      existing = await bucket.head(reservation.object_key);
    } catch {
      return errorResponse("V207_OUTPUT_PREWRITE_HEAD_FAILED", 503);
    }
    if (existing !== null) {
      return errorResponse("V207_OUTPUT_ALREADY_EXISTS", 409);
    }
    let bytes: ArrayBuffer | null;
    try {
      bytes = await readBoundedBody(request, reservation.max_content_length);
    } catch {
      return errorResponse("V207_OUTPUT_BODY_READ_FAILED", 503);
    }
    if (
      bytes === null ||
      !lengthValid(bytes.byteLength, reservation.max_content_length) ||
      (declaredLength !== null && bytes.byteLength !== declaredLength)
    ) {
      return errorResponse("V207_OUTPUT_FACTS_MISMATCH", 400);
    }
    try {
      await bucket.put(reservation.object_key, bytes, {
        httpMetadata: { contentType: "image/png" },
      });
    } catch {
      return errorResponse("V207_OUTPUT_BUCKET_WRITE_FAILED", 503);
    }
    let stored: Awaited<ReturnType<HostedR2BucketBinding["head"]>>;
    try {
      stored = await bucket.head(reservation.object_key);
    } catch {
      return errorResponse("V207_OUTPUT_POSTWRITE_HEAD_FAILED", 503);
    }
    if (
      stored === null ||
      stored.size !== bytes.byteLength ||
      (stored.httpMetadata?.contentType !== undefined &&
        stored.httpMetadata.contentType !== "image/png")
    ) {
      return errorResponse("V207_OUTPUT_WRITE_UNCONFIRMED", 503);
    }
    return new Response(null, { status: 201, headers: { "cache-control": "no-store" } });
  }

  if (request.method === "GET" && operation === "GET") {
    if (
      !exactQuery(url, [
        "capability_handle",
        "claim_key",
        "checksum_sha256",
        "content_length",
        "expires_at",
        "object_key",
        "operation",
        "reservation_id",
        "transfer_id",
      ])
    ) {
      return errorResponse("V207_CAPABILITY_INVALID", 400);
    }
    const reservation = await loadCapabilityReservation(url, bucket);
    const transferId = url.searchParams.get("transfer_id") ?? "";
    const claimKey = url.searchParams.get("claim_key") ?? "";
    const lengthText = url.searchParams.get("content_length") ?? "";
    const checksum = url.searchParams.get("checksum_sha256") ?? "";
    const expiresAt = url.searchParams.get("expires_at") ?? "";
    const presented = url.searchParams.get("capability_handle") ?? "";
    if (
      reservation === null ||
      !ID.test(transferId) ||
      !isExactHostedR2ObjectKey(claimKey) ||
      !reservation.get_claim_keys.includes(claimKey) ||
      !/^\d+$/u.test(lengthText) ||
      !lengthValid(Number(lengthText), reservation.max_content_length) ||
      !CHECKSUM.test(checksum) ||
      !Number.isFinite(Date.parse(expiresAt)) ||
      Date.parse(expiresAt) <= Date.now() ||
      Date.parse(expiresAt) >
        Date.now() + V207_DISPOSABLE_OUTPUT_GET_MAX_LIFETIME_SECONDS * 1_000 + 5_000 ||
      !CAPABILITY.test(presented)
    ) {
      return errorResponse("V207_CAPABILITY_REJECTED", 403);
    }
    const expected = await getCapabilityHandle(
      nonce,
      reservation,
      transferId,
      Number(lengthText),
      checksum,
      expiresAt,
    );
    if (!constantTimeEqual(expected, presented)) {
      return errorResponse("V207_CAPABILITY_REJECTED", 403);
    }
    if ((await bucket.head(claimKey)) !== null) {
      return errorResponse("V207_CAPABILITY_ALREADY_USED", 409);
    }
    const claim = await bucket.put(
      claimKey,
      canonicalBytes({ transfer_id: transferId, used: true }),
      {
        httpMetadata: { contentType: "application/json" },
        onlyIf: { etagDoesNotMatch: "*" },
      },
    );
    if (claim === null) return errorResponse("V207_CAPABILITY_ALREADY_USED", 409);
    if ((await bucket.head(claimKey)) === null) {
      return errorResponse("V207_CAPABILITY_CLAIM_UNCONFIRMED", 503);
    }
    const object = await bucket.get(reservation.object_key);
    if (
      object === null ||
      object.size !== Number(lengthText) ||
      !imageContentTypeMetadataValid(object.httpMetadata?.contentType)
    ) {
      return errorResponse("V207_OUTPUT_NOT_FOUND", 404);
    }
    const bytes = new Uint8Array(await object.arrayBuffer());
    if (bytes.byteLength !== object.size || `sha256:${await sha256Hex(bytes)}` !== checksum) {
      return errorResponse("V207_OUTPUT_FACTS_MISMATCH", 409);
    }
    return new Response(bytes, {
      status: 200,
      headers: {
        "cache-control": "no-store",
        "content-type": "image/png",
        "content-length": String(bytes.byteLength),
        "x-content-type-options": "nosniff",
      },
    });
  }
  return errorResponse("V207_CAPABILITY_INVALID", 405);
}

/**
 * Dedicated Attempt69 control surface.  The nonce is an operator-only deployment secret; without
 * it the Worker is a stable 404 and never reads the R2 binding or constructs a signer.
 */
export async function handleV207DisposableOutputPort(
  request: Request,
  environment: V207DisposableOutputEnvironment,
): Promise<Response | null> {
  const url = new URL(request.url);
  if (url.pathname !== V207_DISPOSABLE_OUTPUT_ROUTE) return null;
  const nonce = environment.VIDEOFORGE_V207_AUTHORITY_NONCE;
  if (!nonce || !NONCE.test(nonce)) return errorResponse("V207_ROUTE_DISABLED", 404);
  const bucket = environment.PRIVATE_ARTIFACTS;
  if (!bucket) return errorResponse("V207_OUTPUT_CONFIGURATION_UNAVAILABLE", 503);
  if (request.method === "PUT" || request.method === "GET") {
    try {
      return await handleCapabilityTransfer(request, url, nonce, bucket);
    } catch {
      return errorResponse("V207_OUTPUT_OPERATION_FAILED", 503);
    }
  }
  if (request.method !== "POST") return errorResponse("V207_REQUEST_INVALID", 405);
  if (!constantTimeEqual(request.headers.get("x-videoforge-v207-authority") ?? "", nonce)) {
    return errorResponse("V207_AUTHORITY_REJECTED", 403);
  }
  const value = await readRequestJson(request);
  if (!isRecord(value)) return errorResponse("V207_REQUEST_INVALID", 400);
  const operation = value.operation;
  if (
    operation !== "PUT" &&
    operation !== "GET" &&
    operation !== "FINALIZE" &&
    operation !== "DELETE"
  ) {
    return errorResponse("V207_REQUEST_INVALID", 400);
  }
  if (!exactKeys(value, operation) || !requestScopeValid(value)) {
    return errorResponse("V207_REQUEST_INVALID", 400);
  }
  try {
    if (operation === "PUT") return await handlePut(nonce, value, bucket, url);
    if (operation === "GET") return await handleGet(nonce, value, bucket, url);
    if (operation === "FINALIZE") return await handleFinalize(nonce, value, bucket);
    return await handleDelete(nonce, value, bucket);
  } catch {
    return errorResponse("V207_OUTPUT_OPERATION_FAILED", 503);
  }
}

export type { DisposableOutputReceipt, DisposableOutputReservation };
