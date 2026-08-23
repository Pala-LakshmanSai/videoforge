import { canonicalizeJson } from "@videoforge/contracts/canonical-json";

import type { HostedRuntimeConfiguration, HostedRuntimeEnvironment } from "./configuration";
import { HostedR2Signer, isExactHostedR2ObjectKey } from "./r2";

const ROUTE = "/api/v2/v207/generated-output-port";
const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/u;
const TOKEN = /^[A-Fa-f0-9]{64}$/u;
const ROLLBACK_TOKEN = /^[a-f0-9]{64}$/u;
const CONTENT_TYPE = /^[a-z0-9][a-z0-9.+-]*\/[a-z0-9][a-z0-9.+-]*$/u;
const CHECKSUM = /^sha256:[0-9a-f]{64}$/u;
const CAPABILITY = /^[a-f0-9]{64}$/u;
const MAX_BODY_BYTES = 64 * 1024;
const MAX_OUTPUT_BYTES = 10_737_418_240;
const GENERATED_PUT_LIFETIME_SECONDS = 7_200;
const GENERATED_OUTPUT_SCHEMA = "artifact-generated-output-authority/v1" as const;
const TRANSFER_PORT_SCHEMA = "artifact-transfer-port/v3" as const;
const RESERVATION_SCHEMA = "artifact-generated-output-reservation/v1" as const;
const FINALIZE_SCHEMA = "videoforge-v207-generated-output-finalization/v1" as const;
const RECEIPT_SCHEMA = "artifact-commit-receipt/v3" as const;

// PNG chunk CRCs cover compressed IDAT bytes. A bit-at-a-time CRC
// loop makes a realistic 1280x720 output need tens of millions of JavaScript
// iterations before the deflate probe can even start.  Keep the same IEEE
// CRC-32 polynomial, but use the standard 256-entry lookup table so probing
// remains bounded on the hosted Worker CPU.
const PNG_CRC32_TABLE = new Uint32Array(256);
for (let index = 0; index < PNG_CRC32_TABLE.length; index += 1) {
  let crc = index;
  for (let bit = 0; bit < 8; bit += 1) {
    crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  PNG_CRC32_TABLE[index] = crc >>> 0;
}

type Operation = "PUT" | "RESERVE" | "GET" | "FINALIZE" | "DELETE";

type GeneratedOutputAuthority = {
  readonly schema_version: typeof GENERATED_OUTPUT_SCHEMA;
  readonly reservation_id: string;
  readonly account_id: string;
  readonly workspace_id: string;
  readonly method: "PUT";
  readonly path: string;
  readonly content_type: string;
  readonly max_content_length: number;
  readonly expires_at: string;
  readonly max_uses: 1;
  readonly capability_handle: string;
};

type ArtifactTransferPortAuthority = {
  readonly schema_version: typeof TRANSFER_PORT_SCHEMA;
  readonly reservation_id: string;
  readonly account_id: string;
  readonly workspace_id: string;
  readonly method: "GET";
  readonly path: string;
  readonly content_type: string;
  readonly content_length: number;
  readonly checksum_sha256: string;
  readonly expires_at: string;
  readonly max_uses: 1;
  readonly capability_handle: string;
};

type GeneratedOutputReservation = Omit<GeneratedOutputAuthority, "schema_version"> & {
  readonly schema_version: typeof RESERVATION_SCHEMA;
  readonly object_key: string;
  readonly provenance_key: string;
  readonly receipt_key: string;
  readonly created_at: string;
};

type ProvenanceKeys = {
  readonly reservationKey: string;
  readonly receiptKey: string;
};

type ArtifactCommitReceipt = {
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
};

function json(value: unknown, status = 200): Response {
  return Response.json(value, {
    status,
    headers: {
      "cache-control": "no-store",
      "content-security-policy": "default-src 'none'; frame-ancestors 'none'",
      "x-content-type-options": "nosniff",
      "x-videoforge-runtime": "hosted-v2-07-output-port",
    },
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function exactKeySet(value: Record<string, unknown>, operation: Operation): boolean {
  const expected =
    operation === "PUT" || operation === "RESERVE"
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
      : operation === "FINALIZE"
        ? [
            "account_id",
            "capability_handle",
            "callback_id",
            "checksum_sha256",
            "content_length",
            "content_type",
            "object_key",
            "operation",
            "reservation_id",
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

const canonical = (value: unknown): string => canonicalizeJson(value);

async function sha256Hex(value: string | Uint8Array): Promise<string> {
  const bytes = typeof value === "string" ? new TextEncoder().encode(value) : value.slice();
  const digest = new Uint8Array(
    await crypto.subtle.digest("SHA-256", bytes.slice().buffer as ArrayBuffer),
  );
  return [...digest].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function hmacHex(secret: string, value: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = new Uint8Array(
    await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(value)),
  );
  return [...signature].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function equalHex(left: string, right: string): boolean {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) {
    difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return difference === 0;
}

function canonicalBytes(value: unknown): ArrayBuffer {
  return new TextEncoder().encode(canonical(value)).buffer as ArrayBuffer;
}

async function readStoredJson(
  bucket: NonNullable<HostedRuntimeEnvironment["PRIVATE_ARTIFACTS"]>,
  key: string,
): Promise<Record<string, unknown> | null> {
  const object = await bucket.get(key);
  if (object === null) return null;
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

function provenanceKeys(objectKey: string): ProvenanceKeys {
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
  const reservationKey = `${base}/${parts[13]}.generated-output-reservation`;
  const receiptKey = `${base}/${parts[13]}.artifact-commit-receipt-v3`;
  if (!isExactHostedR2ObjectKey(reservationKey) || !isExactHostedR2ObjectKey(receiptKey)) {
    throw new Error("V207_PROVENANCE_KEY_INVALID");
  }
  return { reservationKey, receiptKey };
}

function reservationRecordShape(
  value: Record<string, unknown>,
): value is GeneratedOutputReservation {
  return (
    value.schema_version === RESERVATION_SCHEMA &&
    typeof value.reservation_id === "string" &&
    ID.test(value.reservation_id) &&
    typeof value.account_id === "string" &&
    ID.test(value.account_id) &&
    typeof value.workspace_id === "string" &&
    ID.test(value.workspace_id) &&
    typeof value.object_key === "string" &&
    isExactHostedR2ObjectKey(value.object_key) &&
    value.method === "PUT" &&
    typeof value.path === "string" &&
    value.path === `/${value.object_key}` &&
    value.content_type === "image/png" &&
    typeof value.max_content_length === "number" &&
    Number.isSafeInteger(value.max_content_length) &&
    value.max_content_length > 0 &&
    value.max_content_length <= MAX_OUTPUT_BYTES &&
    typeof value.expires_at === "string" &&
    Number.isFinite(Date.parse(value.expires_at)) &&
    value.max_uses === 1 &&
    typeof value.capability_handle === "string" &&
    CAPABILITY.test(value.capability_handle) &&
    typeof value.provenance_key === "string" &&
    typeof value.receipt_key === "string" &&
    typeof value.created_at === "string"
  );
}

function receiptShape(value: Record<string, unknown>): value is ArtifactCommitReceipt {
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
    isExactHostedR2ObjectKey(value.object_key) &&
    typeof value.callback_id === "string" &&
    ID.test(value.callback_id) &&
    value.content_type === "image/png" &&
    typeof value.content_length === "number" &&
    Number.isSafeInteger(value.content_length) &&
    value.content_length > 0 &&
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
    typeof value.receipt_sha256 === "string" &&
    CHECKSUM.test(value.receipt_sha256)
  );
}

function pngCrc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (let index = 0; index < bytes.byteLength; index += 1) {
    const byte = bytes[index]!;
    crc = (crc >>> 8) ^ PNG_CRC32_TABLE[(crc ^ byte) & 0xff]!;
  }
  return (crc ^ 0xffffffff) >>> 0;
}

async function inflatePngScanlines(
  parts: readonly Uint8Array[],
  expectedBytes: number,
): Promise<Uint8Array | null> {
  try {
    const compressedLength = parts.reduce((sum, part) => sum + part.byteLength, 0);
    const compressed = new Uint8Array(compressedLength);
    let offset = 0;
    for (const part of parts) {
      compressed.set(part, offset);
      offset += part.byteLength;
    }
    const body = new Response(compressed.slice().buffer).body;
    if (body === null) return null;
    const stream = body.pipeThrough(new DecompressionStream("deflate"));
    const reader = stream.getReader();
    const inflated = new Uint8Array(expectedBytes);
    let written = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (written + value.byteLength > expectedBytes) {
        await reader.cancel();
        return null;
      }
      inflated.set(value, written);
      written += value.byteLength;
    }
    return written === expectedBytes ? inflated : null;
  } catch {
    return null;
  }
}

async function pngProbe(bytes: Uint8Array): Promise<ArtifactCommitReceipt["probe"] | null> {
  const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (bytes.byteLength < 57 || signature.some((value, index) => bytes[index] !== value))
    return null;
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
    const crcOffset = dataEnd;
    if (dataEnd + 4 > bytes.byteLength) return null;
    const typeBytes = bytes.subarray(offset + 4, offset + 8);
    const type = new TextDecoder().decode(typeBytes);
    const measuredCrc = pngCrc32(bytes.subarray(offset + 4, dataEnd));
    if (measuredCrc !== view.getUint32(crcOffset)) return null;
    if (!sawHeader) {
      if (type !== "IHDR" || length !== 13 || offset !== 8) return null;
      const width = view.getUint32(dataStart);
      const height = view.getUint32(dataStart + 4);
      const bitDepth = bytes[dataStart + 8];
      const colorType = bytes[dataStart + 9];
      const channels = new Map<number, number>([
        [0, 1],
        [2, 3],
        [3, 1],
        [4, 2],
        [6, 4],
      ]).get(colorType ?? -1);
      if (
        width !== 1280 ||
        height !== 720 ||
        bitDepth !== 8 ||
        channels === undefined ||
        bytes[dataStart + 10] !== 0 ||
        bytes[dataStart + 11] !== 0 ||
        bytes[dataStart + 12] !== 0
      ) {
        return null;
      }
      bytesPerPixel = channels;
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
  const scanlineBytes = 1 + 1280 * bytesPerPixel;
  const inflated = await inflatePngScanlines(idatParts, scanlineBytes * 720);
  if (inflated === null) return null;
  for (let row = 0; row < 720; row += 1) {
    const filter = inflated[row * scanlineBytes];
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

async function reservationFor(
  nonce: string,
  accountId: string,
  workspaceId: string,
  objectKey: string,
  maxContentLength: number,
  lifetimeSeconds: number,
  now: Date,
  keys: ProvenanceKeys,
): Promise<GeneratedOutputReservation> {
  const reservationId = `gen_${await sha256Hex(`videoforge-v207-generated:${nonce}:${objectKey}`)}`;
  const authorityBody = {
    schema_version: GENERATED_OUTPUT_SCHEMA,
    reservation_id: reservationId,
    account_id: accountId,
    workspace_id: workspaceId,
    method: "PUT" as const,
    path: `/${objectKey}`,
    content_type: "image/png" as const,
    max_content_length: maxContentLength,
    expires_at: new Date(now.getTime() + lifetimeSeconds * 1_000).toISOString(),
    max_uses: 1 as const,
  };
  const capabilityHandle = await hmacHex(nonce, canonical(authorityBody));
  return {
    ...authorityBody,
    schema_version: RESERVATION_SCHEMA,
    capability_handle: capabilityHandle,
    object_key: objectKey,
    provenance_key: keys.reservationKey,
    receipt_key: keys.receiptKey,
    created_at: now.toISOString(),
  };
}

function reservationMatches(
  record: GeneratedOutputReservation,
  expected: GeneratedOutputReservation,
): boolean {
  return (
    record.schema_version === RESERVATION_SCHEMA &&
    record.reservation_id === expected.reservation_id &&
    record.account_id === expected.account_id &&
    record.workspace_id === expected.workspace_id &&
    record.object_key === expected.object_key &&
    record.path === expected.path &&
    record.content_type === expected.content_type &&
    record.max_content_length === expected.max_content_length &&
    record.max_uses === expected.max_uses &&
    record.provenance_key === expected.provenance_key &&
    record.receipt_key === expected.receipt_key
  );
}

function reservationAuthorityBody(
  reservation: GeneratedOutputReservation,
): Omit<GeneratedOutputAuthority, "capability_handle"> {
  return {
    schema_version: GENERATED_OUTPUT_SCHEMA,
    reservation_id: reservation.reservation_id,
    account_id: reservation.account_id,
    workspace_id: reservation.workspace_id,
    method: "PUT",
    path: reservation.path,
    content_type: reservation.content_type,
    max_content_length: reservation.max_content_length,
    expires_at: reservation.expires_at,
    max_uses: 1,
  };
}

async function receiptFor(
  reservation: GeneratedOutputReservation,
  callbackId: string,
  contentLength: number,
  checksumSha256: string,
  probe: ArtifactCommitReceipt["probe"],
  now: Date,
): Promise<ArtifactCommitReceipt> {
  const receiptBody = {
    reservation_id: reservation.reservation_id,
    account_id: reservation.account_id,
    workspace_id: reservation.workspace_id,
    object_key: reservation.object_key,
    callback_id: callbackId,
    content_type: "image/png" as const,
    content_length: contentLength,
    checksum_sha256: checksumSha256,
    probe,
    retention_class: "PROJECT" as const,
    retain_until: null,
    committed_at: now.toISOString(),
  };
  const receiptSha256 = `sha256:${await sha256Hex(canonical(receiptBody))}`;
  return {
    schema_version: RECEIPT_SCHEMA,
    receipt_id: `receipt_${receiptSha256.slice("sha256:".length, 47)}`,
    ...receiptBody,
    receipt_sha256: receiptSha256,
  };
}

async function receiptHashValid(receipt: ArtifactCommitReceipt): Promise<boolean> {
  const body = { ...receipt } as Record<string, unknown>;
  const receiptSha = body.receipt_sha256;
  delete body.schema_version;
  delete body.receipt_id;
  delete body.receipt_sha256;
  return receiptSha === `sha256:${await sha256Hex(canonical(body))}`;
}

/** Bind a rollback operation to the one exact object key being cleaned up. */
export async function v207RollbackToken(nonce: string, objectKey: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(nonce),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(objectKey));
  return [...new Uint8Array(signature)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function objectKeyMatchesScope(objectKey: string, accountId: string, workspaceId: string): boolean {
  const prefix = `tenant/${accountId}/workspace/${workspaceId}/`;
  return (
    objectKey.startsWith(prefix) &&
    objectKey.includes("/project/") &&
    objectKey.includes("/revision/") &&
    objectKey.includes("/lane/mage-image/job/") &&
    objectKey.includes("/artifact/") &&
    !objectKey.includes("?") &&
    !objectKey.includes("#") &&
    !objectKey.includes("../") &&
    !objectKey.endsWith("/")
  );
}

async function readJson(request: Request): Promise<unknown | null> {
  const declared = request.headers.get("content-length");
  if (declared !== null && (!/^\d+$/u.test(declared) || Number(declared) > MAX_BODY_BYTES)) {
    return null;
  }
  const body = await request.text();
  if (new TextEncoder().encode(body).byteLength > MAX_BODY_BYTES) return null;
  try {
    return JSON.parse(body) as unknown;
  } catch {
    return null;
  }
}

function invalid(code: string): Response {
  return json({ error: { code } }, 400);
}

/**
 * Short-lived activation seam for the approved V2-07 qualification.  The route is inert unless
 * an operator supplies the exact ephemeral nonce in the Worker environment.  It signs direct R2
 * PUT URLs for generated outputs, checksum-bound GET URLs for post-upload durability checks, and
 * one exact-key DELETE rollback operation; it never lists or broadens the tenant-owned namespace.
 */
export async function handleV207GeneratedOutputPort(
  request: Request,
  config: HostedRuntimeConfiguration,
  environment: HostedRuntimeEnvironment,
): Promise<Response | null> {
  const url = new URL(request.url);
  if (url.pathname !== ROUTE || request.method !== "POST") return null;
  const nonce = environment.VIDEOFORGE_V207_AUTHORITY_NONCE;
  if (!nonce || !TOKEN.test(nonce)) return json({ error: { code: "V207_ROUTE_DISABLED" } }, 404);
  if (request.headers.get("x-videoforge-v207-authority") !== nonce) {
    return json({ error: { code: "V207_AUTHORITY_REJECTED" } }, 403);
  }
  const value = await readJson(request);
  if (!isRecord(value)) return invalid("V207_REQUEST_INVALID");
  const operation = value.operation;
  if (
    operation !== "PUT" &&
    operation !== "RESERVE" &&
    operation !== "GET" &&
    operation !== "FINALIZE" &&
    operation !== "DELETE"
  ) {
    return invalid("V207_REQUEST_INVALID");
  }
  if (!exactKeySet(value, operation)) return invalid("V207_REQUEST_INVALID");
  if (
    value.schema_version !== "videoforge-v207-generated-output-port-request/v1" ||
    typeof value.account_id !== "string" ||
    !ID.test(value.account_id) ||
    typeof value.workspace_id !== "string" ||
    !ID.test(value.workspace_id) ||
    typeof value.object_key !== "string" ||
    !isExactHostedR2ObjectKey(value.object_key) ||
    !objectKeyMatchesScope(value.object_key, value.account_id, value.workspace_id)
  ) {
    return invalid("V207_REQUEST_INVALID");
  }
  if (
    operation === "DELETE" &&
    (typeof value.rollback_token !== "string" ||
      !ROLLBACK_TOKEN.test(value.rollback_token) ||
      value.rollback_token !== (await v207RollbackToken(nonce, value.object_key)))
  ) {
    return json({ error: { code: "V207_ROLLBACK_AUTHORITY_REJECTED" } }, 403);
  }
  try {
    const bucket = environment.PRIVATE_ARTIFACTS;
    if ((operation === "PUT" || operation === "RESERVE" || operation === "FINALIZE") && !bucket) {
      return json({ error: { code: "V207_RESERVATION_UNAVAILABLE" } }, 503);
    }
    if (operation === "PUT" || operation === "RESERVE") {
      if (
        value.content_type !== "image/png" ||
        typeof value.max_content_length !== "number" ||
        !Number.isSafeInteger(value.max_content_length) ||
        value.max_content_length < 1 ||
        value.max_content_length > MAX_OUTPUT_BYTES ||
        typeof value.lifetime_seconds !== "number" ||
        !Number.isSafeInteger(value.lifetime_seconds) ||
        value.lifetime_seconds < 1 ||
        value.lifetime_seconds > GENERATED_PUT_LIFETIME_SECONDS
      ) {
        return invalid("V207_REQUEST_INVALID");
      }
      const keys = provenanceKeys(value.object_key);
      const now = new Date();
      const requested = await reservationFor(
        nonce,
        value.account_id,
        value.workspace_id,
        value.object_key,
        value.max_content_length,
        value.lifetime_seconds,
        now,
        keys,
      );
      const stored = await readStoredJson(bucket!, keys.reservationKey);
      let reservation = requested;
      if (stored !== null) {
        if (!reservationRecordShape(stored) || !reservationMatches(stored, requested)) {
          return json({ error: { code: "V207_RESERVATION_CONFLICT" } }, 409);
        }
        reservation = stored;
        const expectedCapability = await hmacHex(
          nonce,
          canonical(reservationAuthorityBody(reservation)),
        );
        if (!equalHex(reservation.capability_handle, expectedCapability)) {
          return json({ error: { code: "V207_RESERVATION_CONFLICT" } }, 409);
        }
        if (Date.parse(reservation.expires_at) <= now.getTime()) {
          return json({ error: { code: "V207_RESERVATION_EXPIRED" } }, 409);
        }
      } else {
        await bucket!.put(keys.reservationKey, canonicalBytes(requested), {
          httpMetadata: { contentType: "application/json" },
        });
      }
      const remainingSeconds = Math.max(
        1,
        Math.min(
          GENERATED_PUT_LIFETIME_SECONDS,
          Math.ceil((Date.parse(reservation.expires_at) - now.getTime()) / 1_000),
        ),
      );
      const signed = await new HostedR2Signer(config.r2).signGenerated({
        objectKey: value.object_key,
        contentType: reservation.content_type,
        maxContentLength: reservation.max_content_length,
        lifetimeSeconds: remainingSeconds,
        now,
      });
      const authority: GeneratedOutputAuthority = {
        schema_version: GENERATED_OUTPUT_SCHEMA,
        reservation_id: reservation.reservation_id,
        account_id: reservation.account_id,
        workspace_id: reservation.workspace_id,
        method: "PUT",
        path: reservation.path,
        content_type: reservation.content_type,
        max_content_length: reservation.max_content_length,
        expires_at: reservation.expires_at,
        max_uses: 1,
        capability_handle: reservation.capability_handle,
      };
      return json({
        schema_version: "videoforge-v207-generated-output-port/v1",
        ...signed,
        authority,
        generated_output_authority: authority,
      });
    }
    if (operation === "FINALIZE") {
      if (
        typeof value.reservation_id !== "string" ||
        !ID.test(value.reservation_id) ||
        typeof value.capability_handle !== "string" ||
        !CAPABILITY.test(value.capability_handle) ||
        typeof value.callback_id !== "string" ||
        !ID.test(value.callback_id) ||
        value.content_type !== "image/png" ||
        typeof value.content_length !== "number" ||
        !Number.isSafeInteger(value.content_length) ||
        value.content_length < 1 ||
        value.content_length > MAX_OUTPUT_BYTES ||
        typeof value.checksum_sha256 !== "string" ||
        !CHECKSUM.test(value.checksum_sha256)
      ) {
        return invalid("V207_REQUEST_INVALID");
      }
      const keys = provenanceKeys(value.object_key);
      const stored = await readStoredJson(bucket!, keys.reservationKey);
      if (stored === null || !reservationRecordShape(stored)) {
        return json({ error: { code: "V207_RESERVATION_NOT_FOUND" } }, 404);
      }
      const reservation = stored;
      if (
        reservation.provenance_key !== keys.reservationKey ||
        reservation.receipt_key !== keys.receiptKey
      ) {
        return json({ error: { code: "V207_RESERVATION_CONFLICT" } }, 409);
      }
      const expectedReservationId = `gen_${await sha256Hex(
        `videoforge-v207-generated:${nonce}:${value.object_key}`,
      )}`;
      const expectedCapability = await hmacHex(
        nonce,
        canonical(reservationAuthorityBody(reservation)),
      );
      if (
        reservation.object_key !== value.object_key ||
        reservation.account_id !== value.account_id ||
        reservation.workspace_id !== value.workspace_id ||
        reservation.reservation_id !== value.reservation_id ||
        reservation.reservation_id !== expectedReservationId ||
        !equalHex(reservation.capability_handle, value.capability_handle) ||
        !equalHex(reservation.capability_handle, expectedCapability)
      ) {
        return json({ error: { code: "V207_RESERVATION_AUTHORITY_REJECTED" } }, 403);
      }
      const object = await bucket!.get(value.object_key);
      if (object === null) return json({ error: { code: "V207_OUTPUT_NOT_FOUND" } }, 404);
      const bytes = new Uint8Array(await object.arrayBuffer());
      if (
        object.size !== bytes.byteLength ||
        bytes.byteLength < 1 ||
        bytes.byteLength > reservation.max_content_length ||
        object.httpMetadata?.contentType !== reservation.content_type ||
        value.content_type !== reservation.content_type ||
        value.content_length !== bytes.byteLength
      ) {
        return json({ error: { code: "V207_OUTPUT_FACTS_MISMATCH" } }, 409);
      }
      const checksumSha256 = `sha256:${await sha256Hex(bytes)}`;
      if (value.checksum_sha256 !== checksumSha256) {
        return json({ error: { code: "V207_OUTPUT_FACTS_MISMATCH" } }, 409);
      }
      const existing = await readStoredJson(bucket!, keys.receiptKey);
      if (existing !== null) {
        if (
          !receiptShape(existing) ||
          !(await receiptHashValid(existing)) ||
          existing.reservation_id !== reservation.reservation_id ||
          existing.account_id !== reservation.account_id ||
          existing.workspace_id !== reservation.workspace_id ||
          existing.object_key !== value.object_key ||
          existing.callback_id !== value.callback_id ||
          existing.content_type !== value.content_type ||
          existing.content_length !== bytes.byteLength ||
          existing.checksum_sha256 !== checksumSha256 ||
          existing.probe.decoded !== true
        ) {
          return json({ error: { code: "V207_RECEIPT_CONFLICT" } }, 409);
        }
        return json({ schema_version: FINALIZE_SCHEMA, receipt: existing, idempotent: true });
      }
      if (Date.parse(reservation.expires_at) <= Date.now()) {
        return json({ error: { code: "V207_RESERVATION_EXPIRED" } }, 409);
      }
      const probe = await pngProbe(bytes);
      if (probe === null) return json({ error: { code: "V207_OUTPUT_PNG_PROBE_FAILED" } }, 409);
      const receipt = await receiptFor(
        reservation,
        value.callback_id,
        bytes.byteLength,
        checksumSha256,
        probe,
        new Date(),
      );
      await bucket!.put(keys.receiptKey, canonicalBytes(receipt), {
        httpMetadata: { contentType: "application/json" },
      });
      return json({ schema_version: FINALIZE_SCHEMA, receipt, idempotent: false });
    }
    if (operation === "DELETE") {
      if (!bucket) return json({ error: { code: "V207_DELETE_UNAVAILABLE" } }, 503);
      const keys = provenanceKeys(value.object_key);
      const deletedKeys = [value.object_key, keys.reservationKey, keys.receiptKey];
      try {
        await bucket.delete(deletedKeys);
        const remaining = [];
        for (const key of deletedKeys) {
          if ((await bucket.head(key)) !== null) remaining.push(key);
        }
        if (remaining.length > 0) {
          return json({ error: { code: "V207_DELETE_UNCONFIRMED" } }, 503);
        }
      } catch {
        return json({ error: { code: "V207_DELETE_VERIFY_FAILED" } }, 503);
      }
      return json({
        schema_version: "videoforge-v207-generated-output-delete/v1",
        deleted: true,
        deleted_keys: deletedKeys,
      });
    }
    if (
      typeof value.content_type !== "string" ||
      !CONTENT_TYPE.test(value.content_type) ||
      typeof value.max_content_length !== "number" ||
      !Number.isSafeInteger(value.max_content_length) ||
      value.max_content_length < 1 ||
      value.max_content_length > MAX_OUTPUT_BYTES ||
      typeof value.lifetime_seconds !== "number" ||
      !Number.isSafeInteger(value.lifetime_seconds) ||
      value.lifetime_seconds < 1 ||
      value.lifetime_seconds > 900
    ) {
      return invalid("V207_REQUEST_INVALID");
    }
    const signer = new HostedR2Signer(config.r2);
    if (
      typeof value.content_length !== "number" ||
      !Number.isSafeInteger(value.content_length) ||
      value.content_length < 1 ||
      value.content_length > value.max_content_length ||
      typeof value.checksum_sha256 !== "string" ||
      !CHECKSUM.test(value.checksum_sha256)
    ) {
      return invalid("V207_REQUEST_INVALID");
    }
    const port = await signer.sign({
      method: "GET",
      objectKey: value.object_key,
      contentType: value.content_type,
      contentLength: value.content_length,
      checksumSha256: value.checksum_sha256,
      lifetimeSeconds: value.lifetime_seconds,
      now: new Date(),
    });
    const authorityBody = {
      schema_version: TRANSFER_PORT_SCHEMA,
      reservation_id: `get_${crypto.randomUUID().replaceAll("-", "")}`,
      account_id: value.account_id,
      workspace_id: value.workspace_id,
      method: "GET" as const,
      path: `/${value.object_key}`,
      content_type: value.content_type,
      content_length: value.content_length,
      checksum_sha256: value.checksum_sha256,
      expires_at: port.expiresAt,
      max_uses: 1 as const,
    };
    const authority: ArtifactTransferPortAuthority = {
      ...authorityBody,
      capability_handle: await hmacHex(nonce, canonical(authorityBody)),
    };
    return json({
      schema_version: "videoforge-v207-generated-output-read-port/v1",
      ...port,
      authority,
    });
  } catch {
    return json({ error: { code: "V207_PORT_SIGNING_FAILED" } }, 503);
  }
}
