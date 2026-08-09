import { describe, expect, it } from "vitest";

import { detectAudioContainer, validateImageFile, validateVoiceoverFile } from "./media-validation";

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

  it("rejects image magic bytes that disagree with the extension before decode", async () => {
    const pngHeader = bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a);
    const file = fixtureFile("renamed.jpg", "image/jpeg", pngHeader);
    await expect(validateImageFile(file)).rejects.toThrow(
      "renamed.jpg contents do not match its extension.",
    );
  });
});
