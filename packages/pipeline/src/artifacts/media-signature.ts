import { constants, open, type FileHandle } from "node:fs/promises";

import {
  LocalArtifactStoreError,
  MAX_ARTIFACT_BYTES,
  MAX_STRUCTURED_MEDIA_BYTES,
} from "./private-contract.js";

const ASCII = new TextDecoder("ascii");
const UTF8 = new TextDecoder("utf-8", { fatal: true });
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const MP4_CONTAINERS = new Set([
  "dinf",
  "edts",
  "mdia",
  "meta",
  "minf",
  "moof",
  "moov",
  "mvex",
  "stbl",
  "traf",
  "trak",
  "udta",
]);

function invalid(contentType: string, reason: string): never {
  throw new LocalArtifactStoreError(
    "MEDIA_SIGNATURE_INVALID",
    `${contentType} bytes failed structural signature validation: ${reason}`,
  );
}

function ascii(bytes: Uint8Array, start: number, end: number): string {
  return ASCII.decode(bytes.subarray(start, end));
}

function assertGenericBounds(contentType: string, bytes: Uint8Array): void {
  if (bytes.byteLength === 0 || bytes.byteLength > MAX_ARTIFACT_BYTES) {
    invalid(contentType, "content must be non-empty and within the artifact byte ceiling");
  }
}

function validateJson(bytes: Uint8Array): void {
  try {
    JSON.parse(UTF8.decode(bytes));
  } catch {
    invalid("application/json", "content is not strict UTF-8 JSON");
  }
}

function validateWav(contentType: string, bytes: Uint8Array): void {
  const buffer = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (
    buffer.byteLength < 44 ||
    ascii(buffer, 0, 4) !== "RIFF" ||
    ascii(buffer, 8, 12) !== "WAVE" ||
    buffer.readUInt32LE(4) + 8 !== buffer.byteLength
  ) {
    invalid(contentType, "RIFF/WAVE envelope or declared length is invalid");
  }
  let offset = 12;
  let validFormat = false;
  let dataBytes = 0;
  let chunks = 0;
  while (offset < buffer.byteLength) {
    if (offset + 8 > buffer.byteLength || chunks++ > 4_096) {
      invalid(contentType, "chunk table is truncated or excessive");
    }
    const kind = ascii(buffer, offset, offset + 4);
    const size = buffer.readUInt32LE(offset + 4);
    const payload = offset + 8;
    const end = payload + size;
    if (end > buffer.byteLength) invalid(contentType, "chunk length escapes the RIFF envelope");
    if (kind === "fmt ") {
      if (size < 16) invalid(contentType, "fmt chunk is too short");
      const format = buffer.readUInt16LE(payload);
      const channels = buffer.readUInt16LE(payload + 2);
      const sampleRate = buffer.readUInt32LE(payload + 4);
      const byteRate = buffer.readUInt32LE(payload + 8);
      const blockAlign = buffer.readUInt16LE(payload + 12);
      const bitsPerSample = buffer.readUInt16LE(payload + 14);
      validFormat =
        (format === 1 || format === 3 || format === 0xfffe) &&
        channels >= 1 &&
        channels <= 32 &&
        sampleRate >= 1_000 &&
        sampleRate <= 768_000 &&
        byteRate > 0 &&
        blockAlign > 0 &&
        bitsPerSample > 0 &&
        bitsPerSample <= 64;
    } else if (kind === "data") {
      dataBytes += size;
    }
    offset = end + (size & 1);
    if (offset > buffer.byteLength) invalid(contentType, "chunk padding escapes the RIFF envelope");
  }
  if (offset !== buffer.byteLength || !validFormat || dataBytes === 0) {
    invalid(contentType, "a valid fmt chunk and non-empty data chunk are required");
  }
}

function validateFlac(bytes: Uint8Array): void {
  const buffer = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (buffer.byteLength < 43 || ascii(buffer, 0, 4) !== "fLaC") {
    invalid("audio/flac", "FLAC marker is missing");
  }
  let offset = 4;
  let blocks = 0;
  let foundLast = false;
  let validStreamInfo = false;
  while (!foundLast) {
    if (offset + 4 > buffer.byteLength || blocks++ > 128) {
      invalid("audio/flac", "metadata block table is truncated or excessive");
    }
    const header = buffer[offset] as number;
    foundLast = (header & 0x80) !== 0;
    const kind = header & 0x7f;
    const length = buffer.readUIntBE(offset + 1, 3);
    const payload = offset + 4;
    const end = payload + length;
    if (end > buffer.byteLength) invalid("audio/flac", "metadata block length is invalid");
    if (blocks === 1) {
      if (kind !== 0 || length !== 34)
        invalid("audio/flac", "STREAMINFO must be first and 34 bytes");
      const packed = buffer.readBigUInt64BE(payload + 10);
      const sampleRate = Number((packed >> 44n) & 0xfffffn);
      const channels = Number(((packed >> 41n) & 0x7n) + 1n);
      const totalSamples = packed & 0xfffffffffn;
      validStreamInfo = sampleRate > 0 && channels >= 1 && channels <= 8 && totalSamples > 0n;
    }
    offset = end;
  }
  if (
    !validStreamInfo ||
    offset + 2 > buffer.byteLength ||
    buffer[offset] !== 0xff ||
    ((buffer[offset + 1] as number) & 0xf8) !== 0xf8
  ) {
    invalid("audio/flac", "valid STREAMINFO and at least one FLAC frame are required");
  }
}

function validateMp3(bytes: Uint8Array): void {
  const buffer = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 0;
  if (buffer.byteLength >= 10 && ascii(buffer, 0, 3) === "ID3") {
    const byte6 = buffer[6] as number;
    const byte7 = buffer[7] as number;
    const byte8 = buffer[8] as number;
    const byte9 = buffer[9] as number;
    if ([byte6, byte7, byte8, byte9].some((entry) => (entry & 0x80) !== 0)) {
      invalid("audio/mpeg", "ID3 size is not synchsafe");
    }
    const tagBytes = (byte6 << 21) | (byte7 << 14) | (byte8 << 7) | byte9;
    offset = 10 + tagBytes;
  }
  if (offset + 5 > buffer.byteLength) invalid("audio/mpeg", "MPEG audio frame is missing");
  const header = buffer.readUInt32BE(offset);
  const version = (header >>> 19) & 0x3;
  const layer = (header >>> 17) & 0x3;
  const bitrate = (header >>> 12) & 0xf;
  const sampleRate = (header >>> 10) & 0x3;
  if (
    (header & 0xffe00000) >>> 0 !== 0xffe00000 ||
    version === 1 ||
    layer === 0 ||
    bitrate === 0 ||
    bitrate === 0xf ||
    sampleRate === 0x3
  ) {
    invalid("audio/mpeg", "MPEG audio frame header is invalid");
  }
}

interface Mp4ScanState {
  boxes: number;
  handlers: Set<string>;
  foundMediaData: boolean;
}

function scanMp4Boxes(
  buffer: Buffer,
  start: number,
  end: number,
  depth: number,
  state: Mp4ScanState,
): void {
  if (depth > 8) invalid("video/mp4", "box nesting is excessive");
  let offset = start;
  while (offset < end) {
    if (offset + 8 > end || state.boxes++ > 4_096) invalid("video/mp4", "box table is invalid");
    let size = buffer.readUInt32BE(offset);
    const kind = ascii(buffer, offset + 4, offset + 8);
    let headerBytes = 8;
    if (size === 1) {
      if (offset + 16 > end) invalid("video/mp4", "extended box header is truncated");
      const extended = buffer.readBigUInt64BE(offset + 8);
      if (extended > BigInt(Number.MAX_SAFE_INTEGER)) invalid("video/mp4", "box is too large");
      size = Number(extended);
      headerBytes = 16;
    } else if (size === 0) {
      size = end - offset;
    }
    if (size < headerBytes || offset + size > end) invalid("video/mp4", "box length is invalid");
    const payload = offset + headerBytes;
    const boxEnd = offset + size;
    if (kind === "hdlr") {
      if (payload + 12 > boxEnd) invalid("video/mp4", "handler box is truncated");
      state.handlers.add(ascii(buffer, payload + 8, payload + 12));
    }
    if (kind === "mdat") state.foundMediaData = boxEnd > payload;
    if (MP4_CONTAINERS.has(kind)) {
      const childStart = kind === "meta" ? payload + 4 : payload;
      if (childStart > boxEnd) invalid("video/mp4", "container header is truncated");
      scanMp4Boxes(buffer, childStart, boxEnd, depth + 1, state);
    }
    offset = boxEnd;
  }
  if (offset !== end) invalid("video/mp4", "box sequence does not consume its envelope");
}

function validateMp4(contentType: "audio/mp4" | "video/mp4", bytes: Uint8Array): void {
  const buffer = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (buffer.byteLength < 24 || ascii(buffer, 4, 8) !== "ftyp") {
    invalid(contentType, "ISO BMFF ftyp box is missing");
  }
  const ftypSize = buffer.readUInt32BE(0);
  if (
    ftypSize < 16 ||
    ftypSize > buffer.byteLength ||
    !/^[\x20-\x7e]{4}$/u.test(ascii(buffer, 8, 12))
  ) {
    invalid(contentType, "ftyp brand or length is invalid");
  }
  const state: Mp4ScanState = { boxes: 0, handlers: new Set(), foundMediaData: false };
  scanMp4Boxes(buffer, 0, buffer.byteLength, 0, state);
  if (!state.foundMediaData) invalid(contentType, "non-empty media data is missing");
  if (contentType === "audio/mp4") {
    if (!state.handlers.has("soun") || state.handlers.has("vide")) {
      invalid(contentType, "an audio-only soun track is required");
    }
  } else if (!state.handlers.has("vide")) {
    invalid(contentType, "a vide track is required");
  }
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let index = 0; index < table.length; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) {
      value = (value & 1) === 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }
    table[index] = value >>> 0;
  }
  return table;
})();

function crc32(bytes: Uint8Array, start: number, end: number): number {
  let value = 0xffffffff;
  for (let index = start; index < end; index += 1) {
    value = (CRC_TABLE[(value ^ (bytes[index] as number)) & 0xff] as number) ^ (value >>> 8);
  }
  return (value ^ 0xffffffff) >>> 0;
}

function validatePng(bytes: Uint8Array): void {
  const buffer = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (buffer.byteLength < 45 || !buffer.subarray(0, 8).equals(PNG_SIGNATURE)) {
    invalid("image/png", "PNG signature is missing");
  }
  let offset = 8;
  let chunks = 0;
  let hasHeader = false;
  let hasData = false;
  let hasEnd = false;
  while (offset < buffer.byteLength) {
    if (offset + 12 > buffer.byteLength || chunks++ > 4_096)
      invalid("image/png", "chunk table is invalid");
    const size = buffer.readUInt32BE(offset);
    const kind = ascii(buffer, offset + 4, offset + 8);
    const dataStart = offset + 8;
    const dataEnd = dataStart + size;
    const chunkEnd = dataEnd + 4;
    if (chunkEnd > buffer.byteLength) invalid("image/png", "chunk length is invalid");
    if (crc32(buffer, offset + 4, dataEnd) !== buffer.readUInt32BE(dataEnd)) {
      invalid("image/png", `${kind} chunk checksum is invalid`);
    }
    if (kind === "IHDR") {
      if (hasHeader || chunks !== 1 || size !== 13) invalid("image/png", "IHDR is invalid");
      const width = buffer.readUInt32BE(dataStart);
      const height = buffer.readUInt32BE(dataStart + 4);
      const bitDepth = buffer[dataStart + 8] as number;
      const colorType = buffer[dataStart + 9] as number;
      if (
        width === 0 ||
        height === 0 ||
        width > 65_535 ||
        height > 65_535 ||
        ![1, 2, 4, 8, 16].includes(bitDepth) ||
        ![0, 2, 3, 4, 6].includes(colorType) ||
        buffer[dataStart + 10] !== 0 ||
        buffer[dataStart + 11] !== 0 ||
        (buffer[dataStart + 12] as number) > 1
      ) {
        invalid("image/png", "IHDR dimensions or format fields are invalid");
      }
      hasHeader = true;
    } else if (kind === "IDAT") {
      hasData ||= size > 0;
    } else if (kind === "IEND") {
      if (size !== 0 || chunkEnd !== buffer.byteLength) invalid("image/png", "IEND is invalid");
      hasEnd = true;
    }
    offset = chunkEnd;
  }
  if (!hasHeader || !hasData || !hasEnd) invalid("image/png", "IHDR, IDAT, and IEND are required");
}

function validateJpeg(bytes: Uint8Array): void {
  const buffer = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (
    buffer.byteLength < 12 ||
    buffer[0] !== 0xff ||
    buffer[1] !== 0xd8 ||
    buffer.at(-2) !== 0xff ||
    buffer.at(-1) !== 0xd9
  ) {
    invalid("image/jpeg", "SOI/EOI markers are missing");
  }
  let offset = 2;
  let markers = 0;
  let hasFrame = false;
  let hasScan = false;
  while (offset < buffer.byteLength - 2 && !hasScan) {
    if (buffer[offset] !== 0xff || markers++ > 4_096)
      invalid("image/jpeg", "marker table is invalid");
    while (buffer[offset] === 0xff) offset += 1;
    const marker = buffer[offset] as number;
    offset += 1;
    if (marker === 0xd9) break;
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
    if (offset + 2 > buffer.byteLength) invalid("image/jpeg", "segment length is truncated");
    const size = buffer.readUInt16BE(offset);
    if (size < 2 || offset + size > buffer.byteLength)
      invalid("image/jpeg", "segment length is invalid");
    const payload = offset + 2;
    if (
      (marker >= 0xc0 && marker <= 0xc3) ||
      (marker >= 0xc5 && marker <= 0xc7) ||
      (marker >= 0xc9 && marker <= 0xcb) ||
      (marker >= 0xcd && marker <= 0xcf)
    ) {
      if (
        size < 8 ||
        buffer.readUInt16BE(payload + 1) === 0 ||
        buffer.readUInt16BE(payload + 3) === 0
      ) {
        invalid("image/jpeg", "frame dimensions are invalid");
      }
      hasFrame = true;
    }
    if (marker === 0xda) hasScan = true;
    offset += size;
  }
  if (!hasFrame || !hasScan || offset >= buffer.byteLength - 2) {
    invalid("image/jpeg", "a dimensioned frame and non-empty scan are required");
  }
}

function validateWebp(bytes: Uint8Array): void {
  const buffer = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (
    buffer.byteLength < 20 ||
    ascii(buffer, 0, 4) !== "RIFF" ||
    ascii(buffer, 8, 12) !== "WEBP" ||
    buffer.readUInt32LE(4) + 8 !== buffer.byteLength
  ) {
    invalid("image/webp", "RIFF/WEBP envelope or declared length is invalid");
  }
  let offset = 12;
  let chunks = 0;
  let hasImage = false;
  while (offset < buffer.byteLength) {
    if (offset + 8 > buffer.byteLength || chunks++ > 128)
      invalid("image/webp", "chunk table is invalid");
    const kind = ascii(buffer, offset, offset + 4);
    const size = buffer.readUInt32LE(offset + 4);
    const payload = offset + 8;
    const end = payload + size;
    if (end > buffer.byteLength) invalid("image/webp", "chunk length is invalid");
    if (kind === "VP8 ") {
      if (
        size < 10 ||
        buffer[payload + 3] !== 0x9d ||
        buffer[payload + 4] !== 0x01 ||
        buffer[payload + 5] !== 0x2a ||
        (buffer.readUInt16LE(payload + 6) & 0x3fff) === 0 ||
        (buffer.readUInt16LE(payload + 8) & 0x3fff) === 0
      ) {
        invalid("image/webp", "VP8 frame header is invalid");
      }
      hasImage = true;
    } else if (kind === "VP8L") {
      if (size < 5 || buffer[payload] !== 0x2f)
        invalid("image/webp", "VP8L frame header is invalid");
      const dimensions = buffer.readUInt32LE(payload + 1);
      if (dimensions >>> 28 !== 0) invalid("image/webp", "VP8L version bits are invalid");
      hasImage = true;
    } else if (kind === "VP8X") {
      if (
        size !== 10 ||
        buffer.readUIntLE(payload + 4, 3) + 1 === 0 ||
        buffer.readUIntLE(payload + 7, 3) + 1 === 0
      )
        invalid("image/webp", "VP8X canvas is invalid");
    }
    offset = end + (size & 1);
    if (offset > buffer.byteLength) invalid("image/webp", "chunk padding is invalid");
  }
  if (offset !== buffer.byteLength || !hasImage)
    invalid("image/webp", "a valid image chunk is required");
}

/** Bounded, deterministic local signature/structure validation for every accepted content type. */
export function validateArtifactMediaBytes(contentType: string, bytes: Uint8Array): void {
  assertGenericBounds(contentType, bytes);
  switch (contentType) {
    case "application/octet-stream":
      return;
    case "application/json":
      return validateJson(bytes);
    case "audio/wav":
    case "audio/x-wav":
      return validateWav(contentType, bytes);
    case "audio/flac":
      return validateFlac(bytes);
    case "audio/mpeg":
      return validateMp3(bytes);
    case "audio/mp4":
    case "video/mp4":
      return validateMp4(contentType, bytes);
    case "image/png":
      return validatePng(bytes);
    case "image/jpeg":
      return validateJpeg(bytes);
    case "image/webp":
      return validateWebp(bytes);
    default:
      return invalid(contentType, "content type is not allowlisted");
  }
}

async function readExact(
  handle: FileHandle,
  position: number,
  length: number,
  contentType: string,
): Promise<Buffer> {
  const buffer = Buffer.alloc(length);
  const { bytesRead } = await handle.read(buffer, 0, length, position);
  if (bytesRead !== length) invalid(contentType, "media structure is truncated");
  return buffer;
}

async function validateLargeWav(
  contentType: "audio/wav" | "audio/x-wav",
  handle: FileHandle,
  byteSize: number,
): Promise<void> {
  const header = await readExact(handle, 0, 12, contentType);
  if (
    ascii(header, 0, 4) !== "RIFF" ||
    ascii(header, 8, 12) !== "WAVE" ||
    header.readUInt32LE(4) + 8 !== byteSize
  ) {
    invalid(contentType, "RIFF/WAVE envelope or declared length is invalid");
  }
  let offset = 12;
  let chunks = 0;
  let validFormat = false;
  let dataBytes = 0;
  while (offset < byteSize) {
    if (chunks++ > 4_096) invalid(contentType, "chunk table is excessive");
    const chunk = await readExact(handle, offset, 8, contentType);
    const kind = ascii(chunk, 0, 4);
    const size = chunk.readUInt32LE(4);
    const payload = offset + 8;
    const end = payload + size;
    if (end > byteSize) invalid(contentType, "chunk length escapes the RIFF envelope");
    if (kind === "fmt ") {
      if (size < 16) invalid(contentType, "fmt chunk is too short");
      const format = await readExact(handle, payload, 16, contentType);
      const encoding = format.readUInt16LE(0);
      const channels = format.readUInt16LE(2);
      const sampleRate = format.readUInt32LE(4);
      const byteRate = format.readUInt32LE(8);
      const blockAlign = format.readUInt16LE(12);
      const bitsPerSample = format.readUInt16LE(14);
      validFormat =
        (encoding === 1 || encoding === 3 || encoding === 0xfffe) &&
        channels >= 1 &&
        channels <= 32 &&
        sampleRate >= 1_000 &&
        sampleRate <= 768_000 &&
        byteRate > 0 &&
        blockAlign > 0 &&
        bitsPerSample > 0 &&
        bitsPerSample <= 64;
    } else if (kind === "data") {
      dataBytes += size;
    }
    offset = end + (size & 1);
    if (offset > byteSize) invalid(contentType, "chunk padding escapes the RIFF envelope");
  }
  if (offset !== byteSize || !validFormat || dataBytes === 0) {
    invalid(contentType, "a valid fmt chunk and non-empty data chunk are required");
  }
}

async function validateLargeFlac(handle: FileHandle, byteSize: number): Promise<void> {
  if (ascii(await readExact(handle, 0, 4, "audio/flac"), 0, 4) !== "fLaC") {
    invalid("audio/flac", "FLAC marker is missing");
  }
  let offset = 4;
  let blocks = 0;
  let foundLast = false;
  let validStreamInfo = false;
  while (!foundLast) {
    if (blocks++ > 128) invalid("audio/flac", "metadata block table is excessive");
    const header = await readExact(handle, offset, 4, "audio/flac");
    foundLast = ((header[0] as number) & 0x80) !== 0;
    const kind = (header[0] as number) & 0x7f;
    const length = header.readUIntBE(1, 3);
    const payload = offset + 4;
    const end = payload + length;
    if (end > byteSize) invalid("audio/flac", "metadata block length is invalid");
    if (blocks === 1) {
      if (kind !== 0 || length !== 34)
        invalid("audio/flac", "STREAMINFO must be first and 34 bytes");
      const streamInfo = await readExact(handle, payload, 34, "audio/flac");
      const packed = streamInfo.readBigUInt64BE(10);
      const sampleRate = Number((packed >> 44n) & 0xfffffn);
      const channels = Number(((packed >> 41n) & 0x7n) + 1n);
      validStreamInfo =
        sampleRate > 0 && channels >= 1 && channels <= 8 && (packed & 0xfffffffffn) > 0n;
    }
    offset = end;
  }
  const frame = await readExact(handle, offset, 2, "audio/flac");
  if (!validStreamInfo || frame[0] !== 0xff || ((frame[1] as number) & 0xf8) !== 0xf8) {
    invalid("audio/flac", "valid STREAMINFO and at least one FLAC frame are required");
  }
}

async function validateLargeMp3(handle: FileHandle, byteSize: number): Promise<void> {
  const start = await readExact(handle, 0, 10, "audio/mpeg");
  let offset = 0;
  if (ascii(start, 0, 3) === "ID3") {
    const sizeBytes = [
      start[6] as number,
      start[7] as number,
      start[8] as number,
      start[9] as number,
    ];
    if (sizeBytes.some((entry) => (entry & 0x80) !== 0))
      invalid("audio/mpeg", "ID3 size is not synchsafe");
    offset =
      10 +
      ((sizeBytes[0] as number) << 21) +
      ((sizeBytes[1] as number) << 14) +
      ((sizeBytes[2] as number) << 7) +
      (sizeBytes[3] as number);
  }
  if (offset + 5 > byteSize) invalid("audio/mpeg", "MPEG audio frame is missing");
  validateMp3(await readExact(handle, offset, 5, "audio/mpeg"));
}

async function scanLargeMp4Boxes(
  handle: FileHandle,
  start: number,
  end: number,
  depth: number,
  contentType: "audio/mp4" | "video/mp4",
  state: Mp4ScanState,
): Promise<void> {
  if (depth > 8) invalid(contentType, "box nesting is excessive");
  let offset = start;
  while (offset < end) {
    if (offset + 8 > end || state.boxes++ > 4_096) invalid(contentType, "box table is invalid");
    const header = await readExact(handle, offset, Math.min(16, end - offset), contentType);
    let size = header.readUInt32BE(0);
    const kind = ascii(header, 4, 8);
    let headerBytes = 8;
    if (size === 1) {
      if (header.byteLength < 16) invalid(contentType, "extended box header is truncated");
      const extended = header.readBigUInt64BE(8);
      if (extended > BigInt(Number.MAX_SAFE_INTEGER)) invalid(contentType, "box is too large");
      size = Number(extended);
      headerBytes = 16;
    } else if (size === 0) {
      size = end - offset;
    }
    if (size < headerBytes || offset + size > end) invalid(contentType, "box length is invalid");
    const payload = offset + headerBytes;
    const boxEnd = offset + size;
    if (kind === "hdlr") {
      if (payload + 12 > boxEnd) invalid(contentType, "handler box is truncated");
      const handler = await readExact(handle, payload, 12, contentType);
      state.handlers.add(ascii(handler, 8, 12));
    }
    if (kind === "mdat") state.foundMediaData ||= boxEnd > payload;
    if (MP4_CONTAINERS.has(kind)) {
      const childStart = kind === "meta" ? payload + 4 : payload;
      if (childStart > boxEnd) invalid(contentType, "container header is truncated");
      await scanLargeMp4Boxes(handle, childStart, boxEnd, depth + 1, contentType, state);
    }
    offset = boxEnd;
  }
  if (offset !== end) invalid(contentType, "box sequence does not consume its envelope");
}

async function validateLargeMp4(
  contentType: "audio/mp4" | "video/mp4",
  handle: FileHandle,
  byteSize: number,
): Promise<void> {
  const first = await readExact(handle, 0, 16, contentType);
  const ftypSize = first.readUInt32BE(0);
  if (
    ascii(first, 4, 8) !== "ftyp" ||
    ftypSize < 16 ||
    ftypSize > byteSize ||
    !/^[\x20-\x7e]{4}$/u.test(ascii(first, 8, 12))
  ) {
    invalid(contentType, "ISO BMFF ftyp box is invalid");
  }
  const state: Mp4ScanState = { boxes: 0, handlers: new Set(), foundMediaData: false };
  await scanLargeMp4Boxes(handle, 0, byteSize, 0, contentType, state);
  if (!state.foundMediaData) invalid(contentType, "non-empty media data is missing");
  if (contentType === "audio/mp4") {
    if (!state.handlers.has("soun") || state.handlers.has("vide")) {
      invalid(contentType, "an audio-only soun track is required");
    }
  } else if (!state.handlers.has("vide")) {
    invalid(contentType, "a vide track is required");
  }
}

/** Validates a durable file without materializing large audio/video bodies in application memory. */
export async function validateArtifactMediaFile(
  contentType: string,
  absolutePath: string,
  byteSize: number,
): Promise<void> {
  if (!Number.isSafeInteger(byteSize) || byteSize < 1 || byteSize > MAX_ARTIFACT_BYTES) {
    invalid(contentType, "file size is outside the artifact byte ceiling");
  }
  const handle = await open(absolutePath, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const information = await handle.stat();
    if (!information.isFile() || information.size !== byteSize) {
      invalid(contentType, "durable file size does not match exact metadata");
    }
    if (byteSize <= MAX_STRUCTURED_MEDIA_BYTES) {
      return validateArtifactMediaBytes(contentType, await handle.readFile());
    }
    switch (contentType) {
      case "application/octet-stream":
        return;
      case "audio/wav":
      case "audio/x-wav":
        return await validateLargeWav(contentType, handle, byteSize);
      case "audio/flac":
        return await validateLargeFlac(handle, byteSize);
      case "audio/mpeg":
        return await validateLargeMp3(handle, byteSize);
      case "audio/mp4":
      case "video/mp4":
        return await validateLargeMp4(contentType, handle, byteSize);
      default:
        return invalid(contentType, "content type exceeds its bounded local validation limit");
    }
  } finally {
    await handle.close();
  }
}
