import type { HostedR2BucketBinding } from "../hosted/configuration";
import { sha256Bytes } from "../hosted/crypto";
import { KieZImageClient, KieZImageError, type KieAspectRatio } from "./kie-z-image";
import type { CompiledImagePrompt } from "@videoforge/pipeline";

const MAX_IMAGE_BYTES = 20 * 1024 * 1024;
const PNG_SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10];
const PNG_CRC_TABLE = Uint32Array.from({ length: 256 }, (_, index) => {
  let crc = index;
  for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  return crc >>> 0;
});
const KIE_PERMANENT_EXCLUSIONS =
  "No visible text, pseudo-text, letters, numbers, labels, signs, logos, branding, watermarks, captions, overlays, UI, charts, diagrams, borders, motion graphics or decorative transitions. Plain unmarked surfaces only.";
const DEFAULT_STYLE_POSITIVE =
  "authentic observational documentary photography, candid and unposed, filmed on location, available practical light, true-to-life colors, soft contrast, realistic skin and material textures, naturally imperfect clothing, tools and environment, ordinary consumer-camera framing, photojournalistic, genuine frame from real stock or documentary footage, believable everyday life, no glossy commercial polish, absolutely photorealistic, no AI look";
const DEFAULT_STYLE_NEGATIVE =
  "illustration, cartoon, anime, CGI, 3D render, digital painting, fantasy, surrealism, plastic skin, waxy face, perfect symmetry, excessive HDR, glamour lighting, studio advertising, staged pose, impossible anatomy, duplicate people, duplicate limbs, malformed hands, unrealistic perfection";
const KIE_DEFAULT_STYLE_POSITIVE =
  "Authentic candid documentary photo, available light, true-to-life color, realistic textures and natural imperfections, unposed everyday life, photorealistic, no AI look";
const KIE_DEFAULT_STYLE_NEGATIVE =
  "illustration, CGI, fantasy, waxy skin, HDR, glamour or studio lighting, staged poses, impossible anatomy, duplicate subjects or limbs";

/** Map the compiled positive and style negatives into Kie's single bounded prompt field. */
export function buildKieScenePrompt(compiled: CompiledImagePrompt): string {
  const c = compiled.components;
  const positiveStyle =
    c.stylePositiveSuffix === DEFAULT_STYLE_POSITIVE
      ? KIE_DEFAULT_STYLE_POSITIVE
      : c.stylePositiveSuffix;
  const negativeStyle =
    c.styleNegativeSuffix === DEFAULT_STYLE_NEGATIVE
      ? KIE_DEFAULT_STYLE_NEGATIVE
      : c.styleNegativeSuffix;
  const prompt = [
    c.literalContent,
    c.continuityAndShotRole,
    c.cropGuidance,
    positiveStyle,
    c.extraPromptKeywords,
    `Avoid: ${negativeStyle}; ${KIE_PERMANENT_EXCLUSIONS}`,
  ]
    .filter(Boolean)
    .join(". ");
  if (!prompt || prompt.length > 1000) throw new KieZImageError("INPUT_INVALID");
  return prompt;
}

export interface KieImageManifest {
  readonly prompt: string;
  readonly aspectRatio: KieAspectRatio;
  readonly nsfwChecker?: boolean;
}

export interface KieImageArtifact {
  readonly objectKey: string;
  readonly sha256: `sha256:${string}`;
  readonly byteSize: number;
  readonly width: number;
  readonly height: number;
  readonly contentType: "image/png";
}

export class KieImageJobError extends Error {
  constructor(
    readonly code:
      | "OUTPUT_KEY_INVALID"
      | "RESULT_DOWNLOAD_FAILED"
      | "RESULT_PNG_INVALID"
      | "RESULT_STORAGE_UNKNOWN",
  ) {
    super(code);
    this.name = "KieImageJobError";
  }
}

type FetchPort = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

/** Claim is a durable PREPARED -> SUBMITTING CAS, before any paid network request. */
export async function submitKieImageJob(input: {
  readonly manifest: KieImageManifest;
  readonly client: KieZImageClient;
  readonly claimSubmission: () => Promise<boolean>;
  readonly persistTaskId: (taskId: string) => Promise<void>;
  readonly markRequestRejected: () => Promise<void>;
  readonly markSubmissionUnknown: () => Promise<void>;
}): Promise<{ readonly state: "NOT_CLAIMED" | "SUBMITTED"; readonly taskId?: string }> {
  if (!(await input.claimSubmission())) return { state: "NOT_CLAIMED" };
  let taskId: string;
  try {
    taskId = await input.client.create(input.manifest);
  } catch (error) {
    if (
      error instanceof KieZImageError &&
      (error.code === "REQUEST_REJECTED" || error.code === "INPUT_INVALID")
    ) {
      await input.markRequestRejected();
      throw error;
    }
    await input.markSubmissionUnknown();
    throw error;
  }
  // If this write fails, the durable SUBMITTING claim still prevents a second paid POST.
  await input.persistTaskId(taskId);
  return { state: "SUBMITTED", taskId };
}

function pngDimensions(bytes: Uint8Array): { width: number; height: number } {
  if (
    bytes.byteLength < 57 ||
    bytes.byteLength > MAX_IMAGE_BYTES ||
    PNG_SIGNATURE.some((byte, index) => bytes[index] !== byte)
  )
    throw new KieImageJobError("RESULT_PNG_INVALID");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const width = view.getUint32(16);
  const height = view.getUint32(20);
  if (
    view.getUint32(8) !== 13 ||
    String.fromCharCode(...bytes.subarray(12, 16)) !== "IHDR" ||
    width < 1 ||
    height < 1 ||
    width > 4096 ||
    height > 4096 ||
    bytes[24] !== 8 ||
    ![2, 6].includes(bytes[25]!) ||
    bytes[26] !== 0 ||
    bytes[27] !== 0 ||
    bytes[28] !== 0
  )
    throw new KieImageJobError("RESULT_PNG_INVALID");
  let offset = 8;
  let imageDataSeen = false;
  while (offset + 12 <= bytes.byteLength) {
    const length = view.getUint32(offset);
    const end = offset + 12 + length;
    if (end > bytes.byteLength) break;
    const type = String.fromCharCode(...bytes.subarray(offset + 4, offset + 8));
    let crc = 0xffffffff;
    for (const byte of bytes.subarray(offset + 4, offset + 8 + length))
      crc = (crc >>> 8) ^ PNG_CRC_TABLE[(crc ^ byte) & 0xff]!;
    if ((crc ^ 0xffffffff) >>> 0 !== view.getUint32(offset + 8 + length)) break;
    if (offset === 8 && (type !== "IHDR" || length !== 13)) break;
    if (type === "IDAT") imageDataSeen = true;
    if (type === "IEND") {
      if (length === 0 && imageDataSeen && end === bytes.byteLength) return { width, height };
      break;
    }
    offset = end;
  }
  throw new KieImageJobError("RESULT_PNG_INVALID");
}

async function readStored(
  bucket: HostedR2BucketBinding,
  objectKey: string,
): Promise<KieImageArtifact | null> {
  const stored = await bucket.get(objectKey);
  if (!stored) return null;
  if (
    stored.size < 57 ||
    stored.size > MAX_IMAGE_BYTES ||
    stored.httpMetadata?.contentType !== "image/png"
  )
    throw new KieImageJobError("RESULT_STORAGE_UNKNOWN");
  const bytes = new Uint8Array(await stored.arrayBuffer());
  if (bytes.byteLength !== stored.size) throw new KieImageJobError("RESULT_STORAGE_UNKNOWN");
  const dimensions = pngDimensions(bytes);
  return {
    objectKey,
    sha256: await sha256Bytes(bytes),
    byteSize: bytes.byteLength,
    ...dimensions,
    contentType: "image/png",
  };
}

async function downloadPng(url: string, fetchPort: FetchPort): Promise<Uint8Array> {
  let response: Response;
  try {
    response = await fetchPort(url, { redirect: "error" });
  } catch {
    throw new KieImageJobError("RESULT_DOWNLOAD_FAILED");
  }
  if (!response.ok || !response.body) throw new KieImageJobError("RESULT_DOWNLOAD_FAILED");
  const declaredLength = Number(response.headers.get("content-length"));
  if (declaredLength > MAX_IMAGE_BYTES) throw new KieImageJobError("RESULT_PNG_INVALID");
  const chunks: Uint8Array[] = [];
  const reader = response.body.getReader();
  let total = 0;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      total += chunk.value.byteLength;
      if (total > MAX_IMAGE_BYTES) {
        await reader.cancel();
        throw new KieImageJobError("RESULT_PNG_INVALID");
      }
      chunks.push(chunk.value);
    }
  } catch (error) {
    if (error instanceof KieImageJobError) throw error;
    throw new KieImageJobError("RESULT_DOWNLOAD_FAILED");
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

/** Observe only a persisted provider task ID. Safe to repeat after an interrupted R2 upload. */
export async function observeKieImageJob(input: {
  readonly taskId: string;
  readonly objectKey: string;
  readonly client: KieZImageClient;
  readonly bucket: HostedR2BucketBinding;
  readonly fetchPort?: FetchPort;
}): Promise<
  | { readonly state: "PENDING" | "FAILED"; readonly failCode?: string | null }
  | { readonly state: "SUCCEEDED"; readonly artifact: KieImageArtifact }
> {
  if (
    !/^tenant\/[0-9a-f-]{36}\/.+\/artifact\/[0-9a-f-]{36}$/u.test(input.objectKey) ||
    input.objectKey.includes("..")
  )
    throw new KieImageJobError("OUTPUT_KEY_INVALID");
  const task = await input.client.get(input.taskId);
  if (task.state === "fail") return { state: "FAILED", failCode: task.failCode };
  if (task.state !== "success") return { state: "PENDING" };
  const previous = await readStored(input.bucket, input.objectKey);
  if (previous) return { state: "SUCCEEDED", artifact: previous };
  const bytes = Uint8Array.from(await downloadPng(task.imageUrl, input.fetchPort ?? fetch));
  const dimensions = pngDimensions(bytes);
  const sha256 = await sha256Bytes(bytes);
  try {
    await input.bucket.put(input.objectKey, bytes.buffer, {
      httpMetadata: { contentType: "image/png" },
    });
  } catch {
    // A completed concurrent write is accepted only after exact private readback below.
  }
  const stored = await readStored(input.bucket, input.objectKey);
  if (!stored || stored.sha256 !== sha256 || stored.byteSize !== bytes.byteLength)
    throw new KieImageJobError("RESULT_STORAGE_UNKNOWN");
  return {
    state: "SUCCEEDED",
    artifact: { ...stored, ...dimensions },
  };
}
