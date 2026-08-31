const MAX_VOICEOVER_BYTES = 1_073_741_824;
const MAX_WAV_CHUNKS = 64;
const MAX_RANGE_READ_BYTES = 64;
const MAX_VALIDATION_READ_BYTES = 64 * 1024;
const MIN_DURATION_SECONDS = 10;
const MAX_DURATION_SECONDS = 3_600;
const MIN_SAMPLE_RATE_HZ = 8_000;
const MAX_SAMPLE_RATE_HZ = 192_000;

const EXTENSIBLE_GUID_TAIL = new Uint8Array([
  0x00, 0x00, 0x10, 0x00, 0x80, 0x00, 0x00, 0xaa, 0x00, 0x38, 0x9b, 0x71,
]);

export type HostedAudioContainer = "AAC" | "FLAC" | "M4A" | "MP3" | "WAV";
export type HostedWavCodec = "IEEE_FLOAT" | "PCM";

export const HOSTED_AUTHORITATIVE_VOICEOVER_CONTENT_TYPES = Object.freeze([
  "audio/wav",
  "audio/mpeg",
] as const);
export const HOSTED_AUTHORITATIVE_VOICEOVER_CONTRACT = Object.freeze({
  schema_version: "videoforge-hosted-authoritative-voiceover-contract/v1" as const,
  accepted_content_types: HOSTED_AUTHORITATIVE_VOICEOVER_CONTENT_TYPES,
  accepted_containers: Object.freeze(["WAV", "MP3"] as const),
  accepted_codecs: Object.freeze(["PCM", "IEEE_FLOAT", "MPEG_LAYER_III"] as const),
  compressed_audio_decode_validation: "PERSONAL_MEDIA_WORKER_FFPROBE_AND_FFMPEG" as const,
  minimum_duration_seconds: MIN_DURATION_SECONDS,
  maximum_duration_seconds: MAX_DURATION_SECONDS,
  minimum_sample_rate_hz: MIN_SAMPLE_RATE_HZ,
  maximum_sample_rate_hz: MAX_SAMPLE_RATE_HZ,
  accepted_channels: Object.freeze([1, 2] as const),
  maximum_content_length: MAX_VOICEOVER_BYTES,
  maximum_range_read_bytes: MAX_RANGE_READ_BYTES,
  maximum_validation_read_bytes: MAX_VALIDATION_READ_BYTES,
});

export function isAuthoritativelySupportedHostedVoiceoverContentType(
  value: string,
): value is (typeof HOSTED_AUTHORITATIVE_VOICEOVER_CONTENT_TYPES)[number] {
  return HOSTED_AUTHORITATIVE_VOICEOVER_CONTENT_TYPES.some((candidate) => candidate === value);
}

export type HostedAudioValidationErrorCode =
  | "VOICEOVER_CONTENT_LENGTH_INVALID"
  | "VOICEOVER_DECLARATION_INVALID"
  | "VOICEOVER_DURATION_INVALID"
  | "VOICEOVER_DURATION_MISMATCH"
  | "VOICEOVER_MAGIC_INVALID"
  | "VOICEOVER_MIME_MAGIC_MISMATCH"
  | "VOICEOVER_MP3_INVALID"
  | "VOICEOVER_READ_FAILED"
  | "VOICEOVER_SERVER_CODEC_UNAVAILABLE"
  | "VOICEOVER_WAV_INVALID";

export class HostedAudioValidationError extends Error {
  readonly code: HostedAudioValidationErrorCode;

  constructor(code: HostedAudioValidationErrorCode, message: string) {
    super(message);
    this.name = "HostedAudioValidationError";
    this.code = code;
  }
}

export interface HostedAudioRangeReader {
  readonly size: number;
  read(offset: number, length: number): Promise<ArrayBuffer | Uint8Array>;
}

export interface HostedVoiceoverValidationInput {
  readonly declaredContentLength: number;
  readonly declaredContentType: string;
  readonly declaredDurationMs: number;
  readonly reader: HostedAudioRangeReader;
}

export interface HostedWavValidationReceipt {
  readonly schema_version: "videoforge-hosted-voiceover-validation/v1";
  readonly validation: "AUTHORITATIVE_BOUNDED_RANGES";
  readonly container: "WAV";
  readonly codec: HostedWavCodec;
  readonly content_length: number;
  readonly duration_ms: number;
  readonly channels: 1 | 2;
  readonly sample_rate_hz: number;
  readonly bits_per_sample: number;
  readonly sample_frames: number;
  readonly data_bytes: number;
  readonly range_reads: number;
  readonly bytes_read: number;
}

export interface HostedMp3ValidationReceipt {
  readonly schema_version: "videoforge-hosted-voiceover-validation/v1";
  readonly validation: "AUTHORITATIVE_CONTAINER_WORKER_DECODE_REQUIRED";
  readonly container: "MP3";
  readonly codec: "MPEG_LAYER_III";
  readonly content_length: number;
  readonly duration_ms: number;
  readonly channels: 1 | 2;
  readonly sample_rate_hz: number;
  readonly first_frame_offset: number;
  readonly first_frame_bytes: number;
  readonly range_reads: number;
  readonly bytes_read: number;
}

export type HostedVoiceoverValidationReceipt =
  | HostedMp3ValidationReceipt
  | HostedWavValidationReceipt;

export interface HostedVoiceoverArtifactProbe {
  readonly source: "HOSTED_AUTHORITATIVE_AUDIO_VALIDATION";
  readonly validation_receipt: HostedVoiceoverValidationReceipt;
}

export function hostedVoiceoverArtifactProbe(
  receipt: HostedVoiceoverValidationReceipt,
): HostedVoiceoverArtifactProbe {
  return Object.freeze({
    source: "HOSTED_AUTHORITATIVE_AUDIO_VALIDATION",
    validation_receipt: receipt,
  });
}

interface ReadAccounting {
  bytesRead: number;
  rangeReads: number;
}

function fail(code: HostedAudioValidationErrorCode, message: string): never {
  throw new HostedAudioValidationError(code, message);
}

function ascii(bytes: Uint8Array, start: number, length: number): string {
  return String.fromCharCode(...bytes.subarray(start, start + length));
}

function uint16(bytes: Uint8Array, offset: number): number {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint16(offset, true);
}

function uint32(bytes: Uint8Array, offset: number): number {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(offset, true);
}

function bytesFrom(value: ArrayBuffer | Uint8Array): Uint8Array {
  return value instanceof Uint8Array
    ? new Uint8Array(value.buffer, value.byteOffset, value.byteLength)
    : new Uint8Array(value);
}

async function readExact(
  reader: HostedAudioRangeReader,
  accounting: ReadAccounting,
  offset: number,
  length: number,
): Promise<Uint8Array> {
  if (
    !Number.isSafeInteger(offset) ||
    !Number.isSafeInteger(length) ||
    offset < 0 ||
    length < 1 ||
    length > MAX_RANGE_READ_BYTES ||
    offset + length > reader.size ||
    accounting.bytesRead + length > MAX_VALIDATION_READ_BYTES
  ) {
    fail(
      "VOICEOVER_READ_FAILED",
      "Voiceover ranged validation exceeded its bounded read contract.",
    );
  }
  let value: ArrayBuffer | Uint8Array;
  try {
    value = await reader.read(offset, length);
  } catch {
    fail("VOICEOVER_READ_FAILED", "Voiceover bytes could not be read for validation.");
  }
  const bytes = bytesFrom(value);
  if (bytes.byteLength !== length) {
    fail("VOICEOVER_READ_FAILED", "Voiceover ranged validation returned an incomplete read.");
  }
  accounting.bytesRead += length;
  accounting.rangeReads += 1;
  return bytes;
}

function detectContainer(header: Uint8Array): HostedAudioContainer | null {
  if (header.byteLength >= 12) {
    if (ascii(header, 0, 4) === "RIFF" && ascii(header, 8, 4) === "WAVE") return "WAV";
    if (ascii(header, 0, 4) === "fLaC") return "FLAC";
    if (ascii(header, 4, 4) === "ftyp") return "M4A";
  }
  if (header.byteLength >= 3 && ascii(header, 0, 3) === "ID3") return "MP3";
  if (
    header.byteLength >= 2 &&
    header[0] === 0xff &&
    header[1] !== undefined &&
    (header[1] & 0xf6) === 0xf0
  ) {
    return "AAC";
  }
  if (
    header.byteLength >= 2 &&
    header[0] === 0xff &&
    header[1] !== undefined &&
    (header[1] & 0xe0) === 0xe0
  ) {
    return "MP3";
  }
  return null;
}

function contentTypeMatches(container: HostedAudioContainer, contentType: string): boolean {
  if (contentType === "audio/wav") return container === "WAV";
  if (contentType === "audio/flac") return container === "FLAC";
  if (contentType === "audio/mpeg") return container === "MP3";
  if (contentType === "audio/mp4") return container === "M4A" || container === "AAC";
  if (contentType === "audio/aac") return container === "AAC";
  return false;
}

function extensibleCodec(bytes: Uint8Array): HostedWavCodec | null {
  if (bytes.byteLength < 40 || uint16(bytes, 16) < 22) return null;
  const tag = uint32(bytes, 24);
  for (let index = 0; index < EXTENSIBLE_GUID_TAIL.byteLength; index += 1) {
    if (bytes[28 + index] !== EXTENSIBLE_GUID_TAIL[index]) return null;
  }
  if (tag === 1) return "PCM";
  if (tag === 3) return "IEEE_FLOAT";
  return null;
}

function supportedBits(codec: HostedWavCodec, bitsPerSample: number): boolean {
  return codec === "PCM"
    ? [8, 16, 24, 32].includes(bitsPerSample)
    : [32, 64].includes(bitsPerSample);
}

async function validateWav(
  input: HostedVoiceoverValidationInput,
  accounting: ReadAccounting,
): Promise<HostedWavValidationReceipt> {
  const { reader } = input;
  const riff = await readExact(reader, accounting, 0, 12);
  if (uint32(riff, 4) + 8 !== reader.size) {
    fail("VOICEOVER_WAV_INVALID", "WAV RIFF length does not match the uploaded object.");
  }

  let offset = 12;
  let chunkCount = 0;
  let codec: HostedWavCodec | null = null;
  let channels = 0;
  let sampleRate = 0;
  let byteRate = 0;
  let blockAlign = 0;
  let bitsPerSample = 0;
  let dataBytes: number | null = null;

  while (offset < reader.size) {
    chunkCount += 1;
    if (chunkCount > MAX_WAV_CHUNKS || offset + 8 > reader.size) {
      fail("VOICEOVER_WAV_INVALID", "WAV chunk structure is invalid or unbounded.");
    }
    const chunkHeader = await readExact(reader, accounting, offset, 8);
    const chunkId = ascii(chunkHeader, 0, 4);
    const chunkBytes = uint32(chunkHeader, 4);
    const payloadOffset = offset + 8;
    const payloadEnd = payloadOffset + chunkBytes;
    const paddedEnd = payloadEnd + (chunkBytes % 2);
    if (!Number.isSafeInteger(paddedEnd) || payloadEnd > reader.size || paddedEnd > reader.size) {
      fail("VOICEOVER_WAV_INVALID", "WAV chunk extends beyond the uploaded object.");
    }

    if (chunkId === "fmt ") {
      if (codec !== null || chunkBytes < 16) {
        fail("VOICEOVER_WAV_INVALID", "WAV must contain one complete format chunk.");
      }
      const format = await readExact(
        reader,
        accounting,
        payloadOffset,
        Math.min(chunkBytes, MAX_RANGE_READ_BYTES),
      );
      const formatTag = uint16(format, 0);
      codec = formatTag === 1 ? "PCM" : formatTag === 3 ? "IEEE_FLOAT" : extensibleCodec(format);
      if (codec === null) {
        fail(
          "VOICEOVER_SERVER_CODEC_UNAVAILABLE",
          "This WAV codec cannot be authoritatively decoded by the hosted edge runtime.",
        );
      }
      channels = uint16(format, 2);
      sampleRate = uint32(format, 4);
      byteRate = uint32(format, 8);
      blockAlign = uint16(format, 12);
      bitsPerSample = uint16(format, 14);
      const extensibleValidBits = formatTag === 0xfffe ? uint16(format, 18) : bitsPerSample;
      if (
        (channels !== 1 && channels !== 2) ||
        sampleRate < MIN_SAMPLE_RATE_HZ ||
        sampleRate > MAX_SAMPLE_RATE_HZ ||
        !supportedBits(codec, bitsPerSample) ||
        extensibleValidBits < 1 ||
        extensibleValidBits > bitsPerSample ||
        bitsPerSample % 8 !== 0 ||
        blockAlign !== channels * (bitsPerSample / 8) ||
        byteRate !== sampleRate * blockAlign
      ) {
        fail(
          "VOICEOVER_WAV_INVALID",
          "WAV channel, sample-rate, or sample-format metadata is invalid.",
        );
      }
    } else if (chunkId === "data") {
      if (dataBytes !== null || chunkBytes < 1) {
        fail("VOICEOVER_WAV_INVALID", "WAV must contain one non-empty audio data chunk.");
      }
      dataBytes = chunkBytes;
    }
    offset = paddedEnd;
  }

  if (codec === null || dataBytes === null || blockAlign < 1 || dataBytes % blockAlign !== 0) {
    fail("VOICEOVER_WAV_INVALID", "WAV format and sample data are incomplete or misaligned.");
  }
  const sampleFrames = dataBytes / blockAlign;
  if (
    sampleFrames < sampleRate * MIN_DURATION_SECONDS ||
    sampleFrames > sampleRate * MAX_DURATION_SECONDS
  ) {
    fail(
      "VOICEOVER_DURATION_INVALID",
      "Voiceover duration must be between 10 seconds and 60 minutes.",
    );
  }
  const durationMs = Math.round((sampleFrames * 1_000) / sampleRate);
  if (input.declaredDurationMs !== durationMs) {
    fail(
      "VOICEOVER_DURATION_MISMATCH",
      "Client duration does not match authoritative WAV metadata.",
    );
  }

  return Object.freeze({
    schema_version: "videoforge-hosted-voiceover-validation/v1",
    validation: "AUTHORITATIVE_BOUNDED_RANGES",
    container: "WAV",
    codec,
    content_length: reader.size,
    duration_ms: durationMs,
    channels: channels as 1 | 2,
    sample_rate_hz: sampleRate,
    bits_per_sample: bitsPerSample,
    sample_frames: sampleFrames,
    data_bytes: dataBytes,
    range_reads: accounting.rangeReads,
    bytes_read: accounting.bytesRead,
  });
}

interface Mp3Frame {
  readonly channels: 1 | 2;
  readonly frameBytes: number;
  readonly sampleRateHz: number;
}

function parseMp3Frame(header: Uint8Array): Mp3Frame | null {
  if (header.byteLength < 4) return null;
  const bits = new DataView(header.buffer, header.byteOffset, 4).getUint32(0, false);
  if (bits >>> 21 !== 0x7ff) return null;
  const versionBits = (bits >>> 19) & 0x3;
  const layerBits = (bits >>> 17) & 0x3;
  const bitrateIndex = (bits >>> 12) & 0xf;
  const sampleRateIndex = (bits >>> 10) & 0x3;
  if (
    versionBits === 1 ||
    layerBits !== 1 ||
    bitrateIndex === 0 ||
    bitrateIndex === 15 ||
    sampleRateIndex === 3
  ) {
    return null;
  }
  const mpeg1 = versionBits === 3;
  const sampleRates =
    versionBits === 3
      ? [44_100, 48_000, 32_000]
      : versionBits === 2
        ? [22_050, 24_000, 16_000]
        : [11_025, 12_000, 8_000];
  const bitratesKbps = mpeg1
    ? [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320]
    : [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160];
  const sampleRateHz = sampleRates[sampleRateIndex];
  const bitrateKbps = bitratesKbps[bitrateIndex];
  if (!sampleRateHz || !bitrateKbps) return null;
  const padding = (bits >>> 9) & 1;
  const frameBytes =
    Math.floor(((mpeg1 ? 144 : 72) * bitrateKbps * 1_000) / sampleRateHz) + padding;
  if (frameBytes < 4) return null;
  return {
    channels: ((bits >>> 6) & 0x3) === 3 ? 1 : 2,
    frameBytes,
    sampleRateHz,
  };
}

function id3PayloadBytes(header: Uint8Array): number | null {
  if (header.byteLength < 10 || ascii(header, 0, 3) !== "ID3") return 0;
  if (
    [header[6], header[7], header[8], header[9]].some(
      (value) => value === undefined || value > 0x7f,
    )
  )
    return null;
  return (
    ((header[6] ?? 0) << 21) | ((header[7] ?? 0) << 14) | ((header[8] ?? 0) << 7) | (header[9] ?? 0)
  );
}

async function validateMp3(
  input: HostedVoiceoverValidationInput,
  accounting: ReadAccounting,
  initialHeader: Uint8Array,
): Promise<HostedMp3ValidationReceipt> {
  const id3Bytes = id3PayloadBytes(initialHeader);
  if (id3Bytes === null) fail("VOICEOVER_MP3_INVALID", "MP3 ID3 metadata is malformed.");
  const hasId3 = ascii(initialHeader, 0, 3) === "ID3";
  const footerBytes = hasId3 && ((initialHeader[5] ?? 0) & 0x10) !== 0 ? 10 : 0;
  const firstFrameOffset = hasId3 ? 10 + id3Bytes + footerBytes : 0;
  if (firstFrameOffset + 4 > input.reader.size) {
    fail("VOICEOVER_MP3_INVALID", "MP3 audio frames are missing.");
  }
  const firstHeader =
    firstFrameOffset === 0
      ? initialHeader.subarray(0, 4)
      : await readExact(input.reader, accounting, firstFrameOffset, 4);
  const firstFrame = parseMp3Frame(firstHeader);
  if (!firstFrame || firstFrameOffset + firstFrame.frameBytes + 4 > input.reader.size) {
    fail("VOICEOVER_MP3_INVALID", "MP3 audio frame metadata is invalid.");
  }
  const secondHeader = await readExact(
    input.reader,
    accounting,
    firstFrameOffset + firstFrame.frameBytes,
    4,
  );
  const secondFrame = parseMp3Frame(secondHeader);
  if (!secondFrame || secondFrame.sampleRateHz !== firstFrame.sampleRateHz) {
    fail("VOICEOVER_MP3_INVALID", "MP3 audio frames are incomplete or inconsistent.");
  }
  if (
    input.declaredDurationMs < MIN_DURATION_SECONDS * 1_000 ||
    input.declaredDurationMs > MAX_DURATION_SECONDS * 1_000
  ) {
    fail(
      "VOICEOVER_DURATION_INVALID",
      "Voiceover duration must be between 10 seconds and 60 minutes.",
    );
  }
  return Object.freeze({
    schema_version: "videoforge-hosted-voiceover-validation/v1",
    validation: "AUTHORITATIVE_CONTAINER_WORKER_DECODE_REQUIRED",
    container: "MP3",
    codec: "MPEG_LAYER_III",
    content_length: input.reader.size,
    duration_ms: input.declaredDurationMs,
    channels: firstFrame.channels,
    sample_rate_hz: firstFrame.sampleRateHz,
    first_frame_offset: firstFrameOffset,
    first_frame_bytes: firstFrame.frameBytes,
    range_reads: accounting.rangeReads,
    bytes_read: accounting.bytesRead,
  });
}

export async function validateHostedVoiceover(
  input: HostedVoiceoverValidationInput,
): Promise<HostedVoiceoverValidationReceipt> {
  const { reader } = input;
  if (
    !Number.isSafeInteger(reader.size) ||
    reader.size < 1 ||
    reader.size > MAX_VOICEOVER_BYTES ||
    input.declaredContentLength !== reader.size
  ) {
    fail(
      "VOICEOVER_CONTENT_LENGTH_INVALID",
      "Voiceover content length is invalid or does not match the uploaded object.",
    );
  }
  if (!isAuthoritativelySupportedHostedVoiceoverContentType(input.declaredContentType)) {
    fail("VOICEOVER_DECLARATION_INVALID", "Voiceover declared content type is unsupported.");
  }
  if (!Number.isSafeInteger(input.declaredDurationMs) || input.declaredDurationMs < 1) {
    fail("VOICEOVER_DECLARATION_INVALID", "Voiceover declared duration is invalid.");
  }

  const accounting: ReadAccounting = { bytesRead: 0, rangeReads: 0 };
  const header = await readExact(reader, accounting, 0, Math.min(12, reader.size));
  const container = detectContainer(header);
  if (container === null) {
    fail(
      "VOICEOVER_MAGIC_INVALID",
      "Voiceover content has no supported audio container signature.",
    );
  }
  if (!contentTypeMatches(container, input.declaredContentType)) {
    fail(
      "VOICEOVER_MIME_MAGIC_MISMATCH",
      "Voiceover MIME type does not match its content signature.",
    );
  }
  if (container === "WAV") return validateWav(input, accounting);
  if (container === "MP3") return validateMp3(input, accounting, header);
  fail("VOICEOVER_DECLARATION_INVALID", "Voiceover declared content type is unsupported.");
}
