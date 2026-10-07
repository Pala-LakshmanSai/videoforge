import { createHash } from "node:crypto";
import { parseMp3Frame } from "./audio-validation";

/** Count actual MPEG frames while streaming. Memory does not grow with narration length. */
export function generatedVoiceoverAudio(minimumSeconds = 10) {
  const digest = createHash("sha256");
  let pending = new Uint8Array(0),
    skip = 0,
    first = true,
    bytes = 0,
    seconds = 0,
    frames = 0;
  let paddingSamples = 0;
  let sampleRate = 0,
    trailingTag = false;
  const invalid = () => {
    throw new Error("GENERATED_VOICEOVER_INVALID_MP3");
  };
  const stream = new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      bytes += chunk.length;
      if (bytes > 1_073_741_824) throw new Error("VOICEOVER_CONTENT_LENGTH_INVALID");
      digest.update(chunk);
      controller.enqueue(chunk);
      const data = new Uint8Array(pending.length + chunk.length);
      data.set(pending);
      data.set(chunk, pending.length);
      let offset = 0;
      while (offset < data.length) {
        if (skip) {
          const n = Math.min(skip, data.length - offset);
          offset += n;
          skip -= n;
          continue;
        }
        if (trailingTag) invalid();
        const left = data.subarray(offset);
        if (first) {
          if (left.length < 10) break;
          first = false;
          if (left[0] === 73 && left[1] === 68 && left[2] === 51) {
            if (left.slice(6, 10).some((v) => v > 127)) invalid();
            skip =
              10 +
              ((left[6]! << 21) | (left[7]! << 14) | (left[8]! << 7) | left[9]!) +
              (left[5]! & 16 ? 10 : 0);
            continue;
          }
        }
        if (left.length < 4) break;
        if (left[0] === 84 && left[1] === 65 && left[2] === 71) {
          trailingTag = true;
          skip = 128;
          continue;
        }
        const frame = parseMp3Frame(left);
        if (!frame || (sampleRate && frame.sampleRateHz !== sampleRate)) return invalid();
        // Xing/Info is a metadata frame, not audible samples. Inspect only the first frame.
        if (frames === 0 && left.length < frame.frameBytes) break;
        const sideBytes =
          frame.samples === 1152 ? (frame.channels === 1 ? 17 : 32) : frame.channels === 1 ? 9 : 17;
        const tagOffset = 4 + ((left[1]! & 1) === 0 ? 2 : 0) + sideBytes;
        const tag =
          frames === 0 ? String.fromCharCode(...left.subarray(tagOffset, tagOffset + 4)) : "";
        sampleRate = frame.sampleRateHz;
        if (tag !== "Xing" && tag !== "Info") seconds += frame.samples / sampleRate;
        else {
          const flags = new DataView(left.buffer, left.byteOffset + tagOffset + 4, 4).getUint32(0);
          const encoderOffset =
            tagOffset +
            8 +
            (flags & 1 ? 4 : 0) +
            (flags & 2 ? 4 : 0) +
            (flags & 4 ? 100 : 0) +
            (flags & 8 ? 4 : 0);
          const encoder = String.fromCharCode(...left.subarray(encoderOffset, encoderOffset + 4));
          if (
            ["LAME", "Lavc", "Lavf"].includes(encoder) &&
            encoderOffset + 24 <= frame.frameBytes
          ) {
            const delay = (left[encoderOffset + 21]! << 4) | (left[encoderOffset + 22]! >> 4);
            const padding = ((left[encoderOffset + 22]! & 15) << 8) | left[encoderOffset + 23]!;
            paddingSamples = delay + padding;
          }
        }
        frames += 1;
        if (seconds > 3601) throw new Error("VOICEOVER_DURATION_INVALID");
        skip = frame.frameBytes;
      }
      pending = data.slice(offset);
    },
    flush() {
      if (first || skip || pending.length || frames < 2) invalid();
      seconds -= paddingSamples / sampleRate;
      if (seconds < minimumSeconds || seconds > 3600) throw new Error("VOICEOVER_DURATION_INVALID");
    },
  });
  return {
    stream,
    receipt: () => ({
      content_length: bytes,
      content_type: "audio/mpeg" as const,
      checksum_sha256: `sha256:${digest.digest("hex")}`,
      duration_ms: Math.round(seconds * 1000),
      filename: "voiceover.mp3",
    }),
  };
}

/** Preserve a known content length across inspection for Workers R2 streaming uploads. */
export function fixedLengthAudioStream(length: number): TransformStream<Uint8Array, Uint8Array> {
  const constructor = (
    globalThis as unknown as {
      FixedLengthStream: new (length: number) => TransformStream<Uint8Array, Uint8Array>;
    }
  ).FixedLengthStream;
  return new constructor(length);
}
