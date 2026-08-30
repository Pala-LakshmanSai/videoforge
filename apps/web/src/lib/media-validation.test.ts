import { afterEach, describe, expect, it, vi } from "vitest";

import {
  boundedImageDimensions,
  buildNormalizedStyleReference,
  detectAudioContainer,
  detectImageContainer,
  validateImageFile,
  validateVoiceoverFile,
} from "./media-validation";

afterEach(() => vi.unstubAllGlobals());

function bytes(...values: number[]): Uint8Array {
  return new Uint8Array(values);
}

function ascii(value: string): number[] {
  return [...value].map((character) => character.charCodeAt(0));
}

function fixtureFile(name: string, type: string, contents: Uint8Array): File {
  return {
    name,
    type,
    size: contents.byteLength,
    arrayBuffer: async () => contents.buffer.slice(0),
  } as File;
}

describe("fixture media validation", () => {
  it.each([
    ["WAV", bytes(...ascii("RIFF"), 0, 0, 0, 0, ...ascii("WAVE"))],
    ["FLAC", bytes(...ascii("fLaC"), 0, 0, 0, 0, 0, 0, 0, 0)],
    ["M4A", bytes(0, 0, 0, 20, ...ascii("ftyp"), ...ascii("M4A "))],
    ["MP3", bytes(...ascii("ID3"), 4, 0, 0, 0, 0, 0)],
    ["MP3", bytes(0xff, 0xfb, 0x90, 0x64)],
    ["AAC", bytes(0xff, 0xf1, 0x50, 0x80)],
  ] as const)("detects %s magic bytes", (container, contents) => {
    expect(detectAudioContainer(contents)).toBe(container);
  });

  it.each([
    bytes(),
    bytes(...ascii("RIFF"), 0, 0, 0, 0, ...ascii("AVI ")),
    bytes(...ascii("not audio data")),
  ])("rejects unknown or incomplete audio magic", (contents) => {
    expect(detectAudioContainer(contents)).toBeNull();
  });

  it("rejects audio whose magic bytes disagree with its extension before decode", async () => {
    const file = fixtureFile("renamed.wav", "audio/wav", bytes(...ascii("ID3"), 4, 0, 0, 0, 0, 0));
    await expect(validateVoiceoverFile(file)).rejects.toThrow(
      "The file contents do not match its audio extension.",
    );
  });

  it("cancels voiceover validation before reading bytes", async () => {
    const controller = new AbortController();
    controller.abort();
    const file = fixtureFile(
      "cancelled.wav",
      "audio/wav",
      bytes(...ascii("RIFF"), 0, 0, 0, 0, ...ascii("WAVE")),
    );
    await expect(validateVoiceoverFile(file, { signal: controller.signal })).rejects.toMatchObject({
      name: "AbortError",
    });
  });

  it("rejects image magic bytes that disagree with the extension before decode", async () => {
    const pngHeader = bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a);
    const file = fixtureFile("renamed.jpg", "image/jpeg", pngHeader);
    await expect(validateImageFile(file)).rejects.toThrow(
      "renamed.jpg contents do not match its extension.",
    );
  });

  it("retains validated avatar bytes, media type, and checksum for persistence", async () => {
    vi.stubGlobal(
      "createImageBitmap",
      vi.fn(async () => ({ width: 512, height: 512, close: vi.fn() })),
    );
    Object.defineProperty(URL, "createObjectURL", {
      configurable: true,
      value: () => "blob:avatar-source",
    });
    const png = bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4);
    const result = await validateImageFile(fixtureFile("maya.png", "image/png", png));

    expect(result).toMatchObject({
      bytesBase64: btoa(String.fromCharCode(...png)),
      filename: "maya.png",
      mediaType: "image/png",
      objectUrl: "blob:avatar-source",
      width: 512,
      height: 512,
    });
    expect(result.checksum).toMatch(/^sha256:[a-f0-9]{64}$/u);
  });

  it("bounds style references without upscaling or changing aspect ratio", () => {
    expect(boundedImageDimensions(4_000, 2_000)).toEqual({ width: 1_600, height: 800 });
    expect(boundedImageDimensions(640, 480)).toEqual({ width: 640, height: 480 });
  });

  it("detects normalized WebP and builds checksum-pinned reference payloads", async () => {
    Object.defineProperty(URL, "createObjectURL", {
      configurable: true,
      value: () => "blob:normalized-reference",
    });
    Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: () => undefined });
    const original = bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4);
    const normalized = bytes(...ascii("RIFF"), 4, 0, 0, 0, ...ascii("WEBP"), 9, 8, 7, 6);
    const file = fixtureFile("owned.png", "image/png", original);
    const normalizedBlob = {
      arrayBuffer: async () => normalized.buffer.slice(0) as ArrayBuffer,
      size: normalized.byteLength,
      type: "image/webp",
    } as Blob;
    const result = await buildNormalizedStyleReference(
      file,
      { width: 640, height: 480 },
      normalizedBlob,
      { width: 640, height: 480 },
      "reference_a",
    );
    expect(detectImageContainer(normalized)).toBe("WEBP");
    expect(result).toMatchObject({
      clientReferenceId: "reference_a",
      filename: "owned.png",
      original: { checksum: expect.stringMatching(/^sha256:[a-f0-9]{64}$/u) },
      normalized: {
        checksum: expect.stringMatching(/^sha256:[a-f0-9]{64}$/u),
        mediaType: "image/webp",
      },
    });
    expect(result.original.checksum).not.toBe(result.normalized.checksum);
    URL.revokeObjectURL(result.objectUrl);
  });
});
