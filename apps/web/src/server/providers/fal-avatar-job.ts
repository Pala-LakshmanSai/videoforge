import type { HostedR2BucketBinding } from "../hosted/configuration";
import { sha256Bytes } from "../hosted/crypto";
import { FalFlashheadClient, FalFlashheadError } from "./fal-flashhead-client";

const MAX_VIDEO_BYTES = 32 * 1024 * 1024;
const OBJECT_KEY =
  /^tenant\/[A-Za-z0-9._:-]+\/workspace\/[A-Za-z0-9._:-]+\/project\/[A-Za-z0-9._:-]+\/revision\/[A-Za-z0-9._:-]+\/lane\/soulx-avatar\/job\/[A-Za-z0-9._:-]+\/artifact\/[A-Za-z0-9._:-]+$/u;

export interface FalAvatarArtifact {
  readonly objectKey: string;
  readonly sha256: `sha256:${string}`;
  readonly byteSize: number;
  readonly durationSeconds: number;
  readonly width: number;
  readonly height: number;
  readonly videoCodec: "h264";
  readonly contentType: "video/mp4";
}

export class FalAvatarJobError extends Error {
  constructor(
    readonly code:
      | "OUTPUT_KEY_INVALID"
      | "RESULT_DOWNLOAD_FAILED"
      | "RESULT_MP4_INVALID"
      | "RESULT_STORAGE_UNKNOWN",
  ) {
    super(code);
    this.name = "FalAvatarJobError";
  }
}

type FetchPort = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

/** Claim is the durable PREPARED -> SUBMITTING CAS, before the paid POST. */
export async function submitFalAvatarJob(input: {
  readonly imageUrl: string;
  readonly audioUrl: string;
  readonly client: FalFlashheadClient;
  readonly claimSubmission: () => Promise<boolean>;
  readonly persistRequestId: (requestId: string) => Promise<void>;
  readonly markSubmissionFailed: () => Promise<void>;
  readonly markSubmissionUnknown: () => Promise<void>;
}): Promise<{ readonly state: "NOT_CLAIMED" | "SUBMITTED"; readonly requestId?: string }> {
  if (!(await input.claimSubmission())) return { state: "NOT_CLAIMED" };
  let requestId: string;
  try {
    requestId = await input.client.submit({ imageUrl: input.imageUrl, audioUrl: input.audioUrl });
  } catch (error) {
    if (
      error instanceof FalFlashheadError &&
      (error.code === "SUBMIT_REJECTED" || error.code === "INPUT_INVALID")
    ) {
      await input.markSubmissionFailed();
      throw error;
    }
    await input.markSubmissionUnknown();
    throw error;
  }
  // Failed persistence leaves SUBMITTING in place; a new POST is forbidden for that attempt.
  await input.persistRequestId(requestId);
  return { state: "SUBMITTED", requestId };
}

type Box = { readonly type: string; readonly start: number; readonly end: number };

function boxes(bytes: Uint8Array, begin: number, end: number): Box[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const result: Box[] = [];
  for (let at = begin; at < end; ) {
    if (at + 8 > end) throw new FalAvatarJobError("RESULT_MP4_INVALID");
    const size = view.getUint32(at);
    const type = String.fromCharCode(...bytes.subarray(at + 4, at + 8));
    if (size < 8 || at + size > end) throw new FalAvatarJobError("RESULT_MP4_INVALID");
    result.push({ type, start: at, end: at + size });
    at += size;
  }
  return result;
}

function inspectMp4(bytes: Uint8Array): { durationSeconds: number; width: number; height: number } {
  if (bytes.byteLength < 1024 || bytes.byteLength > MAX_VIDEO_BYTES)
    throw new FalAvatarJobError("RESULT_MP4_INVALID");
  const top = boxes(bytes, 0, bytes.byteLength);
  const moov = top.find((box) => box.type === "moov");
  const mdat = top.find((box) => box.type === "mdat");
  if (top[0]?.type !== "ftyp" || !moov || !mdat || mdat.end - mdat.start < 1024)
    throw new FalAvatarJobError("RESULT_MP4_INVALID");
  const mvhd = boxes(bytes, moov.start + 8, moov.end).find((box) => box.type === "mvhd");
  if (!mvhd) throw new FalAvatarJobError("RESULT_MP4_INVALID");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const version = bytes[mvhd.start + 8];
  if (version !== 0 || mvhd.end - mvhd.start < 28)
    throw new FalAvatarJobError("RESULT_MP4_INVALID");
  const timescale = view.getUint32(mvhd.start + 20);
  const ticks = view.getUint32(mvhd.start + 24);
  const durationSeconds = ticks / timescale;
  if (
    !timescale ||
    !Number.isFinite(durationSeconds) ||
    durationSeconds <= 0 ||
    durationSeconds > 3600
  )
    throw new FalAvatarJobError("RESULT_MP4_INVALID");
  // H.264 sample-entry width/height are fixed fields of the avc1 box. Search only inside moov.
  let width = 0;
  let height = 0;
  for (let at = moov.start + 12; at + 32 <= moov.end; at++) {
    if (String.fromCharCode(...bytes.subarray(at, at + 4)) !== "avc1") continue;
    const size = view.getUint32(at - 4);
    if (size < 36 || at - 4 + size > moov.end) continue;
    width = view.getUint16(at + 28);
    height = view.getUint16(at + 30);
    if (width && height) break;
  }
  if (width !== 512 || height !== 512) throw new FalAvatarJobError("RESULT_MP4_INVALID");
  return { durationSeconds, width, height };
}

async function readStored(
  bucket: HostedR2BucketBinding,
  objectKey: string,
): Promise<FalAvatarArtifact | null> {
  const stored = await bucket.get(objectKey);
  if (!stored) return null;
  if (stored.size > MAX_VIDEO_BYTES || stored.httpMetadata?.contentType !== "video/mp4")
    throw new FalAvatarJobError("RESULT_STORAGE_UNKNOWN");
  const bytes = new Uint8Array(await stored.arrayBuffer());
  if (bytes.byteLength !== stored.size) throw new FalAvatarJobError("RESULT_STORAGE_UNKNOWN");
  const metadata = inspectMp4(bytes);
  return {
    objectKey,
    sha256: await sha256Bytes(bytes),
    byteSize: bytes.byteLength,
    ...metadata,
    videoCodec: "h264",
    contentType: "video/mp4",
  };
}

async function downloadMp4(url: string, fetchPort: FetchPort): Promise<Uint8Array> {
  let response: Response;
  try {
    response = await fetchPort(url, { redirect: "error" });
  } catch {
    throw new FalAvatarJobError("RESULT_DOWNLOAD_FAILED");
  }
  if (!response.ok || !response.body) throw new FalAvatarJobError("RESULT_DOWNLOAD_FAILED");
  const declaredLength = Number(response.headers.get("content-length"));
  if (declaredLength > MAX_VIDEO_BYTES) throw new FalAvatarJobError("RESULT_MP4_INVALID");
  const chunks: Uint8Array[] = [];
  const reader = response.body.getReader();
  let total = 0;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      total += chunk.value.byteLength;
      if (total > MAX_VIDEO_BYTES) {
        await reader.cancel();
        throw new FalAvatarJobError("RESULT_MP4_INVALID");
      }
      chunks.push(chunk.value);
    }
  } catch (error) {
    if (error instanceof FalAvatarJobError) throw error;
    throw new FalAvatarJobError("RESULT_DOWNLOAD_FAILED");
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

/** Poll an already persisted request ID; safe to repeat after interrupted private storage. */
export async function observeFalAvatarJob(input: {
  readonly requestId: string;
  readonly objectKey: string;
  readonly client: FalFlashheadClient;
  readonly bucket: HostedR2BucketBinding;
  readonly fetchPort?: FetchPort;
}): Promise<
  | { readonly state: "PENDING" | "FAILED" }
  | { readonly state: "SUCCEEDED"; readonly artifact: FalAvatarArtifact }
> {
  if (!OBJECT_KEY.test(input.objectKey) || input.objectKey.includes(".."))
    throw new FalAvatarJobError("OUTPUT_KEY_INVALID");
  const state = await input.client.status(input.requestId);
  if (state === "FAILED" || state === "CANCELLED") return { state: "FAILED" };
  if (state !== "COMPLETED") return { state: "PENDING" };
  const previous = await readStored(input.bucket, input.objectKey);
  if (previous) return { state: "SUCCEEDED", artifact: previous };
  const result = await input.client.result(input.requestId);
  const bytes = Uint8Array.from(await downloadMp4(result.videoUrl, input.fetchPort ?? fetch));
  const metadata = inspectMp4(bytes);
  if (Math.abs(metadata.durationSeconds - result.durationSeconds) > 1)
    throw new FalAvatarJobError("RESULT_MP4_INVALID");
  const sha256 = await sha256Bytes(bytes);
  try {
    await input.bucket.put(input.objectKey, bytes.buffer, {
      httpMetadata: { contentType: "video/mp4" },
    });
  } catch {
    // A concurrent successful write is accepted only after exact readback below.
  }
  const stored = await readStored(input.bucket, input.objectKey);
  if (!stored || stored.sha256 !== sha256 || stored.byteSize !== bytes.byteLength)
    throw new FalAvatarJobError("RESULT_STORAGE_UNKNOWN");
  return { state: "SUCCEEDED", artifact: stored };
}
