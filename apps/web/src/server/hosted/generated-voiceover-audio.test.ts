import { createHash } from "node:crypto";
import { expect, it } from "vitest";
import { generatedVoiceoverAudio } from "./generated-voiceover-audio";
// MPEG-1 Layer III, 128kbps/44.1kHz: 417-byte frames, 1152 samples each.
function mp3(frames = 600) {
  const audio = new Uint8Array(10 + frames * 417 + 128);
  audio.set([73, 68, 51, 4, 0, 0, 0, 0, 0, 0]);
  for (let i = 0; i < frames; i++) audio.set([255, 251, 144, 0], 10 + i * 417);
  audio.set([84, 65, 71], audio.length - 128);
  return audio;
}
async function inspect(bytes: Uint8Array, chunk = 997) {
  const measured = generatedVoiceoverAudio();
  let offset = 0;
  await new ReadableStream<Uint8Array>({
    pull(controller) {
      if (offset === bytes.length) {
        controller.close();
        return;
      }
      controller.enqueue(bytes.slice(offset, offset + chunk));
      offset = Math.min(bytes.length, offset + chunk);
    },
  })
    .pipeThrough(measured.stream)
    .pipeTo(new WritableStream({ write() {} }));
  return measured.receipt();
}
it.each([1, 3, 997, 65536])(
  "measures full MP3 duration and checksum across %s byte boundaries",
  async (chunk) => {
    const bytes = mp3();
    const result = await inspect(bytes, chunk);
    expect(result.duration_ms).toBe(Math.round(((600 * 1152) / 44100) * 1000));
    expect(result.content_length).toBe(bytes.length);
    expect(result.checksum_sha256).toBe(
      `sha256:${createHash("sha256").update(bytes).digest("hex")}`,
    );
  },
);
it("rejects truncated frames and sub-ten-second narration", async () => {
  await expect(inspect(mp3().slice(0, -140))).rejects.toThrow("GENERATED_VOICEOVER_INVALID_MP3");
  await expect(inspect(mp3(2))).rejects.toThrow("VOICEOVER_DURATION_INVALID");
});
it("rejects response text and corrupt middle frames", async () => {
  await expect(inspect(new TextEncoder().encode("<html>Access denied</html>"))).rejects.toThrow(
    "GENERATED_VOICEOVER_INVALID_MP3",
  );
  const bytes = mp3();
  bytes[10 + 300 * 417] = 0;
  await expect(inspect(bytes)).rejects.toThrow("GENERATED_VOICEOVER_INVALID_MP3");
});

it("excludes the Xing metadata frame and declared encoder delay/padding", async () => {
  const bytes = mp3();
  const start = 10 + 36;
  bytes.set(new TextEncoder().encode("Info"), start);
  bytes.set([0, 0, 0, 0], start + 4);
  bytes.set(new TextEncoder().encode("Lavf"), start + 8);
  bytes.set([0x24, 0x03, 0xc0], start + 8 + 21); // 576 delay + 960 padding samples.
  const result = await inspect(bytes, 31);
  expect(result.duration_ms).toBe(Math.round(((599 * 1152 - 1536) / 44100) * 1000));
});
