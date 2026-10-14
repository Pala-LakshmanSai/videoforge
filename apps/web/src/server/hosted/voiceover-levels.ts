import { createHash } from "node:crypto";
import type { MPEGDecoder } from "mpg123-decoder";
import { parseMp3Frame } from "./audio-validation";

const WINDOW_SECONDS = 0.5;
const GAIN_STEP_DB = (20 * Math.log10(2)) / 4;
const MAX_BYTES = 1_073_741_824;
interface Level {
  rms: number;
  peak: number;
}
export interface VoiceoverLevels {
  sourceChecksum: string;
  contentLength: number;
  gains: number[];
}
const db = (value: number) => 20 * Math.log10(Math.max(value, 1e-12));
function percentile(values: number[], fraction: number) {
  values.sort((a, b) => a - b);
  return values[Math.floor((values.length - 1) * fraction)]!;
}

/** Correct sustained speech-level drift; retain pauses, local expression and peak headroom. */
export function speechGains(levels: readonly Level[]): number[] {
  const audible = levels.map((level) => db(level.rms)).filter((value) => value > -60);
  if (!audible.length) return levels.map(() => 0);
  const target = percentile(audible, 0.9);
  return levels.map((_, index) => {
    const speech = levels
      .slice(Math.max(0, index - 4), index + 5)
      .map((level) => db(level.rms))
      .filter((value) => value > -65);
    const desired = Math.min(
      27,
      Math.max(0, target - (speech.length ? percentile(speech, 0.7) : target)),
    );
    // Look ahead across gain boundaries; never boost a quiet block into the next loud syllable.
    const peakLimit = Math.min(
      ...levels.slice(Math.max(0, index - 2), index + 3).map((level) => -2 - db(level.peak)),
    );
    return Math.floor(Math.min(desired, peakLimit) / GAIN_STEP_DB);
  });
}

/** Streaming analysis retains only half-second measurements, never the complete decoded audio. */
export async function measureVoiceoverLevels(
  source: ReadableStream<Uint8Array>,
  decoder: MPEGDecoder,
): Promise<VoiceoverLevels> {
  const digest = createHash("sha256");
  const levels: Level[] = [];
  let contentLength = 0,
    sum = 0,
    peak = 0,
    count = 0,
    samples = 0,
    sampleRate = 0;
  const reader = source.getReader();
  try {
    await decoder.ready;
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      contentLength += next.value.length;
      if (contentLength > MAX_BYTES) throw new Error("VOICEOVER_CONTENT_LENGTH_INVALID");
      digest.update(next.value);
      for (let offset = 0; offset < next.value.length; offset += 65536) {
        const decoded = decoder.decode(next.value.subarray(offset, offset + 65536));
        if (decoded.errors.length) throw new Error("GENERATED_VOICEOVER_INVALID_MP3");
        if (!decoded.samplesDecoded) continue;
        if (sampleRate && decoded.sampleRate !== sampleRate)
          throw new Error("GENERATED_VOICEOVER_INVALID_MP3");
        sampleRate = decoded.sampleRate;
        samples += decoded.samplesDecoded;
        if (samples / sampleRate > 3601) throw new Error("VOICEOVER_DURATION_INVALID");
        for (let index = 0; index < decoded.samplesDecoded; index++) {
          let value = 0;
          for (const channel of decoded.channelData)
            value = Math.max(value, Math.abs(channel[index]!));
          if (!Number.isFinite(value)) throw new Error("GENERATED_VOICEOVER_INVALID_MP3");
          sum += value * value;
          peak = Math.max(peak, value);
          count++;
          if (count >= sampleRate * WINDOW_SECONDS) {
            levels.push({ rms: Math.sqrt(sum / count), peak });
            sum = peak = count = 0;
          }
        }
      }
    }
    if (count) levels.push({ rms: Math.sqrt(sum / count), peak });
    if (!samples) throw new Error("GENERATED_VOICEOVER_INVALID_MP3");
    return { sourceChecksum: digest.digest("hex"), contentLength, gains: speechGains(levels) };
  } catch (error) {
    await reader.cancel(error);
    throw error;
  } finally {
    reader.releaseLock();
    decoder.free();
  }
}

function bits(bytes: Uint8Array, position: number, length: number): number {
  let value = 0;
  for (let index = 0; index < length; index++) {
    const bit = position + index;
    value = (value << 1) | ((bytes[bit >> 3]! >> (7 - (bit & 7))) & 1);
  }
  return value;
}
function putGain(bytes: Uint8Array, position: number, value: number) {
  for (let index = 0; index < 8; index++) {
    const bit = position + index,
      byte = bit >> 3,
      shift = 7 - (bit & 7);
    bytes[byte] = (bytes[byte]! & ~(1 << shift)) | (((value >> (7 - index)) & 1) << shift);
  }
}

/** MPEG Layer III global_gain changes amplitude without re-encoding or moving any samples. */
export function adjustMp3FrameGain(frame: Uint8Array, requestedGain: number): void {
  const header = parseMp3Frame(frame);
  if (!header || frame.length !== header.frameBytes)
    throw new Error("GENERATED_VOICEOVER_INVALID_MP3");
  const mpeg1 = header.samples === 1152,
    crc = (frame[1]! & 1) === 0;
  const sideOffset = crc ? 6 : 4;
  const sideLength = mpeg1 ? (header.channels === 1 ? 17 : 32) : header.channels === 1 ? 9 : 17;
  const start = mpeg1 ? (header.channels === 1 ? 18 : 20) : header.channels === 1 ? 9 : 10;
  const positions: number[] = [];
  for (let index = 0; index < (mpeg1 ? 2 : 1) * header.channels; index++) {
    const granule = sideOffset * 8 + start + index * (mpeg1 ? 59 : 63);
    // Empty granules have no spectral data; their zero gain must not block peak attenuation.
    if (bits(frame, granule, 12)) positions.push(granule + 21);
  }
  if (!positions.length) return;
  // Saturate all channels/granules together, preserving stereo balance.
  const gain = Math.max(
    ...positions.map((position) => -bits(frame, position, 8)),
    Math.min(requestedGain, ...positions.map((position) => 255 - bits(frame, position, 8))),
  );
  for (const position of positions) putGain(frame, position, bits(frame, position, 8) + gain);
  if (crc && gain) {
    let checksum = 0xffff;
    for (const byte of [...frame.subarray(2, 4), ...frame.subarray(6, 6 + sideLength)]) {
      checksum ^= byte << 8;
      for (let bit = 0; bit < 8; bit++)
        checksum = ((checksum << 1) ^ (checksum & 0x8000 ? 0x8005 : 0)) & 0xffff;
    }
    frame[4] = checksum >> 8;
    frame[5] = checksum & 255;
  }
}

/** Second pass keeps MP3 length/timing exact and rejects a changed provider download. */
export function levelVoiceoverStream(
  plan: VoiceoverLevels,
): TransformStream<Uint8Array, Uint8Array> {
  const digest = createHash("sha256");
  let pending = new Uint8Array(0),
    first = true,
    tagBytes = 0,
    trailing = false;
  let contentLength = 0,
    seconds = 0,
    frameCount = 0;
  return new TransformStream({
    transform(chunk, controller) {
      contentLength += chunk.length;
      if (contentLength > plan.contentLength) throw new Error("GENERATED_VOICEOVER_SOURCE_CHANGED");
      digest.update(chunk);
      const data = new Uint8Array(pending.length + chunk.length);
      data.set(pending);
      data.set(chunk, pending.length);
      let offset = 0;
      while (offset < data.length) {
        if (tagBytes) {
          const size = Math.min(tagBytes, data.length - offset);
          controller.enqueue(data.slice(offset, offset + size));
          offset += size;
          tagBytes -= size;
          continue;
        }
        const left = data.subarray(offset);
        if (trailing) throw new Error("GENERATED_VOICEOVER_INVALID_MP3");
        if (first) {
          if (left.length < 10) break;
          first = false;
          if (left[0] === 73 && left[1] === 68 && left[2] === 51) {
            if (left.slice(6, 10).some((value) => value > 127))
              throw new Error("GENERATED_VOICEOVER_INVALID_MP3");
            tagBytes =
              10 +
              ((left[6]! << 21) | (left[7]! << 14) | (left[8]! << 7) | left[9]!) +
              (left[5]! & 16 ? 10 : 0);
            continue;
          }
        }
        if (left.length < 4) break;
        if (left[0] === 84 && left[1] === 65 && left[2] === 71) {
          trailing = true;
          tagBytes = 128;
          continue;
        }
        const header = parseMp3Frame(left);
        if (!header) throw new Error("GENERATED_VOICEOVER_INVALID_MP3");
        if (left.length < header.frameBytes) break;
        const frame = left.slice(0, header.frameBytes);
        const side =
          header.samples === 1152
            ? header.channels === 1
              ? 17
              : 32
            : header.channels === 1
              ? 9
              : 17;
        const tagOffset = 4 + ((frame[1]! & 1) === 0 ? 2 : 0) + side;
        const tag = String.fromCharCode(...frame.subarray(tagOffset, tagOffset + 4));
        if (frameCount || (tag !== "Xing" && tag !== "Info")) {
          const gain =
            plan.gains[Math.min(plan.gains.length - 1, Math.floor(seconds / WINDOW_SECONDS))];
          if (gain === undefined) throw new Error("GENERATED_VOICEOVER_INVALID_MP3");
          adjustMp3FrameGain(frame, gain);
          seconds += header.samples / header.sampleRateHz;
        }
        controller.enqueue(frame);
        frameCount++;
        offset += header.frameBytes;
      }
      pending = data.slice(offset);
    },
    flush() {
      if (first || tagBytes || pending.length || frameCount < 2)
        throw new Error("GENERATED_VOICEOVER_INVALID_MP3");
      if (contentLength !== plan.contentLength || digest.digest("hex") !== plan.sourceChecksum)
        throw new Error("GENERATED_VOICEOVER_SOURCE_CHANGED");
    },
  });
}
