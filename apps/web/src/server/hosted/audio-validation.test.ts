import { describe, expect, it } from "vitest";

import {
  HOSTED_AUTHORITATIVE_VOICEOVER_CONTENT_TYPES,
  HOSTED_AUTHORITATIVE_VOICEOVER_CONTRACT,
  HostedAudioValidationError,
  type HostedAudioRangeReader,
  hostedVoiceoverArtifactProbe,
  isAuthoritativelySupportedHostedVoiceoverContentType,
  validateHostedVoiceover,
} from "./audio-validation";

interface SyntheticWavOptions {
  readonly bitsPerSample?: number;
  readonly channels?: number;
  readonly durationSeconds?: number;
  readonly formatTag?: number;
  readonly sampleRate?: number;
}

function writeAscii(bytes: Uint8Array, offset: number, value: string): void {
  for (let index = 0; index < value.length; index += 1) {
    bytes[offset + index] = value.charCodeAt(index);
  }
}

function syntheticWav(options: SyntheticWavOptions = {}) {
  const channels = options.channels ?? 1;
  const sampleRate = options.sampleRate ?? 16_000;
  const bitsPerSample = options.bitsPerSample ?? 16;
  const durationSeconds = options.durationSeconds ?? 20;
  const formatTag = options.formatTag ?? 1;
  const blockAlign = channels * (bitsPerSample / 8);
  const byteRate = sampleRate * blockAlign;
  const dataBytes = byteRate * durationSeconds;
  const contentLength = 44 + dataBytes;
  const header = new Uint8Array(44);
  const view = new DataView(header.buffer);
  writeAscii(header, 0, "RIFF");
  view.setUint32(4, contentLength - 8, true);
  writeAscii(header, 8, "WAVE");
  writeAscii(header, 12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, formatTag, true);
  view.setUint16(22, channels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitsPerSample, true);
  writeAscii(header, 36, "data");
  view.setUint32(40, dataBytes, true);

  const reads: { length: number; offset: number }[] = [];
  const reader: HostedAudioRangeReader = {
    size: contentLength,
    async read(offset, length) {
      reads.push({ offset, length });
      const result = new Uint8Array(length);
      for (let index = 0; index < length; index += 1) {
        result[index] = header[offset + index] ?? 0;
      }
      return result;
    },
  };
  return { contentLength, header, reader, reads };
}

function byteReader(bytes: Uint8Array): HostedAudioRangeReader {
  return {
    size: bytes.byteLength,
    async read(offset, length) {
      return bytes.slice(offset, offset + length);
    },
  };
}

async function expectCode(promise: Promise<unknown>, code: HostedAudioValidationError["code"]) {
  await expect(promise).rejects.toMatchObject({ code, name: "HostedAudioValidationError" });
}

describe("authoritative hosted voiceover validation", () => {
  it("exports the exact fail-closed hosted edge codec contract", () => {
    expect(HOSTED_AUTHORITATIVE_VOICEOVER_CONTENT_TYPES).toEqual(["audio/wav"]);
    expect(HOSTED_AUTHORITATIVE_VOICEOVER_CONTRACT).toMatchObject({
      schema_version: "videoforge-hosted-authoritative-voiceover-contract/v1",
      accepted_content_types: ["audio/wav"],
      accepted_containers: ["WAV"],
      accepted_codecs: ["PCM", "IEEE_FLOAT"],
      minimum_duration_seconds: 10,
      maximum_duration_seconds: 3_600,
      minimum_sample_rate_hz: 8_000,
      maximum_sample_rate_hz: 192_000,
      accepted_channels: [1, 2],
      maximum_content_length: 1_073_741_824,
      maximum_range_read_bytes: 64,
      maximum_validation_read_bytes: 65_536,
    });
    expect(isAuthoritativelySupportedHostedVoiceoverContentType("audio/wav")).toBe(true);
    expect(isAuthoritativelySupportedHostedVoiceoverContentType("audio/mpeg")).toBe(false);
  });

  it("validates PCM WAV metadata without reading sample payload bytes", async () => {
    const fixture = syntheticWav();
    const receipt = await validateHostedVoiceover({
      declaredContentLength: fixture.contentLength,
      declaredContentType: "audio/wav",
      declaredDurationMs: 20_000,
      reader: fixture.reader,
    });

    expect(receipt).toMatchObject({
      schema_version: "videoforge-hosted-voiceover-validation/v1",
      validation: "AUTHORITATIVE_BOUNDED_RANGES",
      container: "WAV",
      codec: "PCM",
      duration_ms: 20_000,
      channels: 1,
      sample_rate_hz: 16_000,
      bits_per_sample: 16,
      sample_frames: 320_000,
      data_bytes: 640_000,
    });
    expect(Math.max(...fixture.reads.map((read) => read.length))).toBeLessThanOrEqual(64);
    expect(fixture.reads.reduce((total, read) => total + read.length, 0)).toBeLessThan(128);
    expect(fixture.reads.every((read) => read.offset + read.length <= 44)).toBe(true);
    expect(hostedVoiceoverArtifactProbe(receipt)).toEqual({
      source: "HOSTED_AUTHORITATIVE_AUDIO_VALIDATION",
      validation_receipt: receipt,
    });
  });

  it("accepts structurally decodable IEEE-float WAV", async () => {
    const fixture = syntheticWav({ bitsPerSample: 32, channels: 2, formatTag: 3 });
    await expect(
      validateHostedVoiceover({
        declaredContentLength: fixture.contentLength,
        declaredContentType: "audio/wav",
        declaredDurationMs: 20_000,
        reader: fixture.reader,
      }),
    ).resolves.toMatchObject({ codec: "IEEE_FLOAT", channels: 2, bits_per_sample: 32 });
  });

  it("rejects client duration drift from authoritative sample metadata", async () => {
    const fixture = syntheticWav();
    await expectCode(
      validateHostedVoiceover({
        declaredContentLength: fixture.contentLength,
        declaredContentType: "audio/wav",
        declaredDurationMs: 19_999,
        reader: fixture.reader,
      }),
      "VOICEOVER_DURATION_MISMATCH",
    );
  });

  it.each([9, 3_601])("rejects a %s-second WAV outside the duration contract", async (seconds) => {
    const fixture = syntheticWav({ bitsPerSample: 8, durationSeconds: seconds, sampleRate: 8_000 });
    await expectCode(
      validateHostedVoiceover({
        declaredContentLength: fixture.contentLength,
        declaredContentType: "audio/wav",
        declaredDurationMs: seconds * 1_000,
        reader: fixture.reader,
      }),
      "VOICEOVER_DURATION_INVALID",
    );
  });

  it.each([
    { channels: 3 },
    { sampleRate: 7_999 },
    { sampleRate: 192_001 },
    { bitsPerSample: 12 },
  ] as const)("rejects invalid WAV metadata for %o", async (options) => {
    const fixture = syntheticWav(options);
    await expectCode(
      validateHostedVoiceover({
        declaredContentLength: fixture.contentLength,
        declaredContentType: "audio/wav",
        declaredDurationMs: 20_000,
        reader: fixture.reader,
      }),
      "VOICEOVER_WAV_INVALID",
    );
  });

  it("rejects MIME and magic-byte disagreement", async () => {
    const bytes = new Uint8Array([0x49, 0x44, 0x33, 4, 0, 0, 0, 0, 0, 0, 0, 0]);
    await expectCode(
      validateHostedVoiceover({
        declaredContentLength: bytes.byteLength,
        declaredContentType: "audio/wav",
        declaredDurationMs: 20_000,
        reader: byteReader(bytes),
      }),
      "VOICEOVER_MIME_MAGIC_MISMATCH",
    );
  });

  it.each([
    ["FLAC", "audio/flac", new Uint8Array([0x66, 0x4c, 0x61, 0x43, 0, 0, 0, 0, 0, 0, 0, 0])],
    ["MP3", "audio/mpeg", new Uint8Array([0x49, 0x44, 0x33, 4, 0, 0, 0, 0, 0, 0, 0, 0])],
    [
      "M4A",
      "audio/mp4",
      new Uint8Array([0, 0, 0, 12, 0x66, 0x74, 0x79, 0x70, 0x4d, 0x34, 0x41, 0x20]),
    ],
    ["AAC", "audio/mp4", new Uint8Array([0xff, 0xf1, 0x50, 0x80, 0, 0, 0, 0, 0, 0, 0, 0])],
  ] as const)(
    "fails closed for %s without an authoritative edge decoder",
    async (_, type, bytes) => {
      await expectCode(
        validateHostedVoiceover({
          declaredContentLength: bytes.byteLength,
          declaredContentType: type,
          declaredDurationMs: 20_000,
          reader: byteReader(bytes),
        }),
        "VOICEOVER_SERVER_CODEC_UNAVAILABLE",
      );
    },
  );

  it("rejects a compressed codec inside a WAV container", async () => {
    const fixture = syntheticWav({ formatTag: 6 });
    await expectCode(
      validateHostedVoiceover({
        declaredContentLength: fixture.contentLength,
        declaredContentType: "audio/wav",
        declaredDurationMs: 20_000,
        reader: fixture.reader,
      }),
      "VOICEOVER_SERVER_CODEC_UNAVAILABLE",
    );
  });

  it("rejects object-length drift before reading any bytes", async () => {
    const fixture = syntheticWav();
    await expectCode(
      validateHostedVoiceover({
        declaredContentLength: fixture.contentLength - 1,
        declaredContentType: "audio/wav",
        declaredDurationMs: 20_000,
        reader: fixture.reader,
      }),
      "VOICEOVER_CONTENT_LENGTH_INVALID",
    );
    expect(fixture.reads).toHaveLength(0);
  });

  it("rejects RIFF length drift from the uploaded object", async () => {
    const fixture = syntheticWav();
    new DataView(fixture.header.buffer).setUint32(4, fixture.contentLength - 9, true);
    await expectCode(
      validateHostedVoiceover({
        declaredContentLength: fixture.contentLength,
        declaredContentType: "audio/wav",
        declaredDurationMs: 20_000,
        reader: fixture.reader,
      }),
      "VOICEOVER_WAV_INVALID",
    );
  });

  it("rejects WAVs that exceed the bounded chunk-scan limit", async () => {
    const chunkCount = 65;
    const bytes = new Uint8Array(12 + chunkCount * 8);
    const view = new DataView(bytes.buffer);
    writeAscii(bytes, 0, "RIFF");
    view.setUint32(4, bytes.byteLength - 8, true);
    writeAscii(bytes, 8, "WAVE");
    for (let index = 0; index < chunkCount; index += 1) {
      const offset = 12 + index * 8;
      writeAscii(bytes, offset, "JUNK");
      view.setUint32(offset + 4, 0, true);
    }

    const reads: { length: number; offset: number }[] = [];
    const reader: HostedAudioRangeReader = {
      size: bytes.byteLength,
      async read(offset, length) {
        reads.push({ offset, length });
        return bytes.slice(offset, offset + length);
      },
    };

    await expectCode(
      validateHostedVoiceover({
        declaredContentLength: bytes.byteLength,
        declaredContentType: "audio/wav",
        declaredDurationMs: 20_000,
        reader,
      }),
      "VOICEOVER_WAV_INVALID",
    );
    expect(reads.filter((read) => read.length === 8)).toHaveLength(64);
    expect(reads.some((read) => read.offset === 12 + 64 * 8)).toBe(false);
  });
});
