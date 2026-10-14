// @vitest-environment node
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { expect, it } from "vitest";
import { MPEGDecoder } from "mpg123-decoder";
import {
  adjustMp3FrameGain,
  levelVoiceoverStream,
  measureVoiceoverLevels,
  speechGains,
} from "./voiceover-levels";
import { parseMp3Frame } from "./audio-validation";

const fixture = new Uint8Array(
  readFileSync(new URL("../../../tests/fixtures/audio/speech-level-fade.mp3", import.meta.url)),
);
function source(bytes: Uint8Array, chunkSize = 65536) {
  let offset = 0;
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      if (offset >= bytes.length) return controller.close();
      controller.enqueue(bytes.slice(offset, offset + chunkSize));
      offset += chunkSize;
    },
  });
}
async function decode(bytes: Uint8Array) {
  const decoder = new MPEGDecoder({ enableGapless: false });
  await decoder.ready;
  try {
    const result = decoder.decode(bytes);
    expect(result.errors).toEqual([]);
    return result;
  } finally {
    decoder.free();
  }
}
const checksum = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");

it("levels a twenty-decibel fade without changing MP3 size, timing or encoded speech", async () => {
  const plan = await measureVoiceoverLevels(
    source(fixture, 511),
    new MPEGDecoder({ enableGapless: false }),
  );
  expect(plan.sourceChecksum).toBe(checksum(fixture));
  const result = new Uint8Array(
    await new Response(source(fixture, 137).pipeThrough(levelVoiceoverStream(plan))).arrayBuffer(),
  );
  expect(result.length).toBe(fixture.length);
  const before = await decode(fixture),
    after = await decode(result);
  expect(after.samplesDecoded).toBe(before.samplesDecoded);
  expect(after.sampleRate).toBe(before.sampleRate);
  const rms = (audio: Float32Array, start: number, end: number) => {
    const slice = audio.subarray(start * after.sampleRate, end * after.sampleRate);
    return Math.sqrt(slice.reduce((sum, value) => sum + value * value, 0) / slice.length);
  };
  const initial = rms(after.channelData[0]!, 2, 4),
    faded = rms(after.channelData[0]!, 11, 13);
  expect(Math.abs(20 * Math.log10(initial / faded))).toBeLessThan(3);
  expect(
    20 * Math.log10(rms(before.channelData[0]!, 2, 4) / rms(before.channelData[0]!, 11, 13)),
  ).toBeGreaterThan(12);
  expect(after.channelData[0]!.every((sample) => Math.abs(sample) < 0.8)).toBe(true);
  let offset = 45; // Synthetic fixture's ID3v2 tag; no source audio is embedded in repository tests.
  expect(String.fromCharCode(...fixture.slice(0, 3))).toBe("ID3");
  offset = 10 + ((fixture[6]! << 21) | (fixture[7]! << 14) | (fixture[8]! << 7) | fixture[9]!);
  while (offset < fixture.length) {
    const header = parseMp3Frame(fixture.subarray(offset))!;
    const mainDataOffset = offset + 4 + (header.channels === 1 ? 17 : 32);
    expect(result.subarray(mainDataOffset, offset + header.frameBytes)).toEqual(
      fixture.subarray(mainDataOffset, offset + header.frameBytes),
    );
    offset += header.frameBytes;
  }
});

it("preserves a silent stream and never amplifies a pause in isolation", () => {
  expect(speechGains(Array.from({ length: 12 }, () => ({ rms: 0, peak: 0 })))).toEqual(
    Array(12).fill(0),
  );
  const levels = Array.from({ length: 30 }, () => ({ rms: 0.1, peak: 0.3 }));
  levels[15] = { rms: 0, peak: 0 };
  expect(speechGains(levels)).toEqual(Array(30).fill(0));
});

it("anticipates loud resets and limits both channels by the louder channel", () => {
  const levels = Array.from({ length: 30 }, (_, i) =>
    i < 20 ? { rms: 0.01, peak: 0.04 } : { rms: 0.2, peak: 0.75 },
  );
  const gains = speechGains(levels);
  expect(gains[10]).toBeGreaterThan(10);
  expect(gains[18]).toBe(0);
  expect(gains[20]).toBe(0);
});

it("rejects a changed second download before the result can be committed", async () => {
  const plan = await measureVoiceoverLevels(
    source(fixture),
    new MPEGDecoder({ enableGapless: false }),
  );
  const changed = fixture.slice();
  changed[25] = changed[25]! ^ 1;
  await expect(
    new Response(source(changed).pipeThrough(levelVoiceoverStream(plan))).arrayBuffer(),
  ).rejects.toThrow("GENERATED_VOICEOVER_SOURCE_CHANGED");
  await expect(
    new Response(
      source(fixture.slice(0, -1)).pipeThrough(levelVoiceoverStream(plan)),
    ).arrayBuffer(),
  ).rejects.toThrow();
});

it.each([0xfb, 0xf3, 0xe3])(
  "handles MPEG version header %i and preserves unchanged frames",
  (version) => {
    const prefix = new Uint8Array([255, version, 128, 192]);
    const header = parseMp3Frame(prefix)!;
    const frame = new Uint8Array(header.frameBytes);
    frame.set(prefix);
    const granule = 32 + (header.samples === 1152 ? 18 : 9);
    frame[granule >> 3] = 1 << (7 - (granule & 7));
    const before = frame.slice();
    adjustMp3FrameGain(frame, 0);
    expect(frame).toEqual(before);
    adjustMp3FrameGain(frame, 10);
    expect(frame).not.toEqual(before);
    expect(parseMp3Frame(frame)).toEqual(header);
  },
);
