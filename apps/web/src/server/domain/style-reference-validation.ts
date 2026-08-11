import type { ImageStyleReferenceBatchRequest } from "@videoforge/contracts/image-style-hub";

const MAX_REFERENCE_BYTES = 20_000_000;
const MAX_NORMALIZED_BYTES = 8_000_000;
const MAX_TOTAL_BYTES = 80_000_000;
const MAX_PIXELS = 20_000_000;

export interface ValidatedFixtureStyleReference {
  readonly clientReferenceId: string;
  readonly filename: string;
  readonly orderIndex: number;
  readonly originalChecksum: string;
  readonly normalizedChecksum: string;
  readonly width: number;
  readonly height: number;
  readonly normalizedBytes: Uint8Array;
}

interface RasterFacts {
  readonly mediaType: "image/jpeg" | "image/png" | "image/webp";
  readonly width: number;
  readonly height: number;
}

function u24le(bytes: Uint8Array, offset: number): number {
  return bytes[offset]! | (bytes[offset + 1]! << 8) | (bytes[offset + 2]! << 16);
}

export function inspectRaster(bytes: Uint8Array): RasterFacts | null {
  if (
    bytes.length >= 24 &&
    bytes[0] === 0x89 &&
    String.fromCharCode(...bytes.subarray(1, 4)) === "PNG" &&
    String.fromCharCode(...bytes.subarray(12, 16)) === "IHDR"
  ) {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const width = view.getUint32(16);
    const height = view.getUint32(20);
    const hasEnd =
      bytes.length >= 12 &&
      String.fromCharCode(...bytes.subarray(bytes.length - 8, bytes.length - 4)) === "IEND";
    if (view.getUint32(8) !== 13 || !hasEnd || width === 0 || height === 0) return null;
    return { mediaType: "image/png", width, height };
  }
  if (
    bytes.length >= 30 &&
    String.fromCharCode(...bytes.subarray(0, 4)) === "RIFF" &&
    String.fromCharCode(...bytes.subarray(8, 12)) === "WEBP"
  ) {
    const riffSize = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(
      4,
      true,
    );
    if (riffSize + 8 !== bytes.length) return null;
    const kind = String.fromCharCode(...bytes.subarray(12, 16));
    if (kind === "VP8X") {
      return {
        mediaType: "image/webp",
        width: 1 + u24le(bytes, 24),
        height: 1 + u24le(bytes, 27),
      };
    }
    if (
      kind === "VP8 " &&
      bytes.length >= 30 &&
      bytes[23] === 0x9d &&
      bytes[24] === 0x01 &&
      bytes[25] === 0x2a
    ) {
      return {
        mediaType: "image/webp",
        width: (bytes[26]! | (bytes[27]! << 8)) & 0x3fff,
        height: (bytes[28]! | (bytes[29]! << 8)) & 0x3fff,
      };
    }
    if (kind === "VP8L" && bytes.length >= 25 && bytes[20] === 0x2f) {
      const packed = bytes[21]! | (bytes[22]! << 8) | (bytes[23]! << 16) | (bytes[24]! << 24);
      return {
        mediaType: "image/webp",
        width: 1 + (packed & 0x3fff),
        height: 1 + ((packed >>> 14) & 0x3fff),
      };
    }
    return null;
  }
  if (bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8) {
    let offset = 2;
    while (offset + 8 < bytes.length) {
      if (bytes[offset] !== 0xff) {
        offset += 1;
        continue;
      }
      const marker = bytes[offset + 1]!;
      if (marker === 0xd9 || marker === 0xda) break;
      if (marker === 0xd8 || marker === 0x01) {
        offset += 2;
        continue;
      }
      const length = (bytes[offset + 2]! << 8) | bytes[offset + 3]!;
      if (length < 2 || offset + 2 + length > bytes.length) return null;
      if (
        [0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(
          marker,
        )
      ) {
        return {
          mediaType: "image/jpeg",
          height: (bytes[offset + 5]! << 8) | bytes[offset + 6]!,
          width: (bytes[offset + 7]! << 8) | bytes[offset + 8]!,
        };
      }
      offset += 2 + length;
    }
  }
  return null;
}

function decodeBase64(value: string): Uint8Array {
  const binary = atob(value);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

async function digest(bytes: Uint8Array): Promise<string> {
  const hashed = new Uint8Array(
    await crypto.subtle.digest(
      "SHA-256",
      bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer,
    ),
  );
  return `sha256:${Array.from(hashed, (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}

function declaredDimensionsMatch(facts: RasterFacts, width: number, height: number): boolean {
  return (
    (facts.width === width && facts.height === height) ||
    (facts.mediaType === "image/jpeg" && facts.width === height && facts.height === width)
  );
}

function webpHasForbiddenMetadata(bytes: Uint8Array): boolean {
  let offset = 12;
  while (offset + 8 <= bytes.length) {
    const kind = String.fromCharCode(...bytes.subarray(offset, offset + 4));
    const length = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(
      offset + 4,
      true,
    );
    const next = offset + 8 + length + (length % 2);
    if (next > bytes.length) throw new Error("Normalized WebP chunk table is truncated.");
    if (["EXIF", "XMP "].includes(kind)) return true;
    offset = next;
  }
  if (offset !== bytes.length) throw new Error("Normalized WebP has trailing bytes.");
  return false;
}

export async function validateFixtureStyleReferences(
  request: ImageStyleReferenceBatchRequest,
): Promise<ValidatedFixtureStyleReference[]> {
  let totalBytes = 0;
  const validated: ValidatedFixtureStyleReference[] = [];
  for (const reference of request.references) {
    const original = decodeBase64(reference.original.bytes_base64);
    const normalized = decodeBase64(reference.normalized.bytes_base64);
    totalBytes += original.byteLength + normalized.byteLength;
    if (original.byteLength === 0 || original.byteLength > MAX_REFERENCE_BYTES) {
      throw new Error(`${reference.filename} original byte length is invalid.`);
    }
    if (normalized.byteLength === 0 || normalized.byteLength > MAX_NORMALIZED_BYTES) {
      throw new Error(`${reference.filename} normalized byte length is invalid.`);
    }
    if (totalBytes > MAX_TOTAL_BYTES) throw new Error("Reference batch exceeds 80 MB.");
    if (
      (await digest(original)) !== reference.original.checksum ||
      (await digest(normalized)) !== reference.normalized.checksum
    ) {
      throw new Error(`${reference.filename} checksum does not match its bytes.`);
    }
    const originalFacts = inspectRaster(original);
    const normalizedFacts = inspectRaster(normalized);
    if (!originalFacts || originalFacts.mediaType !== reference.original.media_type) {
      throw new Error(`${reference.filename} original magic or raster metadata is invalid.`);
    }
    if (!normalizedFacts || normalizedFacts.mediaType !== "image/webp") {
      throw new Error(`${reference.filename} normalized derivative is not a valid WebP raster.`);
    }
    if (webpHasForbiddenMetadata(normalized)) {
      throw new Error(`${reference.filename} normalized derivative retains forbidden metadata.`);
    }
    if (
      !declaredDimensionsMatch(originalFacts, reference.original.width, reference.original.height)
    ) {
      throw new Error(`${reference.filename} original dimensions do not match its raster.`);
    }
    if (
      normalizedFacts.width !== reference.normalized.width ||
      normalizedFacts.height !== reference.normalized.height
    ) {
      throw new Error(`${reference.filename} normalized dimensions do not match its raster.`);
    }
    if (
      originalFacts.width * originalFacts.height > MAX_PIXELS ||
      normalizedFacts.width * normalizedFacts.height > MAX_PIXELS ||
      Math.max(normalizedFacts.width, normalizedFacts.height) > 1_600 ||
      Math.min(normalizedFacts.width, normalizedFacts.height) < 256
    ) {
      throw new Error(
        `${reference.filename} raster dimensions exceed the safe normalization profile.`,
      );
    }
    const expectedScale = Math.min(
      1,
      1_600 / Math.max(reference.original.width, reference.original.height),
    );
    const expectedWidth = Math.max(1, Math.round(reference.original.width * expectedScale));
    const expectedHeight = Math.max(1, Math.round(reference.original.height * expectedScale));
    if (normalizedFacts.width !== expectedWidth || normalizedFacts.height !== expectedHeight) {
      throw new Error(`${reference.filename} normalized derivative has unexpected geometry.`);
    }
    validated.push({
      clientReferenceId: reference.client_reference_id,
      filename: reference.filename,
      orderIndex: reference.order_index,
      originalChecksum: reference.original.checksum,
      normalizedChecksum: reference.normalized.checksum,
      width: normalizedFacts.width,
      height: normalizedFacts.height,
      normalizedBytes: normalized,
    });
  }
  return validated.sort((left, right) => left.orderIndex - right.orderIndex);
}
