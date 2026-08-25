export interface VerifiedVoiceover {
  assetId: string;
  channels: number;
  checksum: `sha256:${string}`;
  durationSeconds: number;
  filename: string;
  sampleRate: number;
}

export interface VerifiedImage {
  filename: string;
  height: number;
  objectUrl: string;
  width: number;
}

export interface NormalizedStyleReference extends VerifiedImage {
  clientReferenceId: string;
  original: {
    bytesBase64: string;
    checksum: `sha256:${string}`;
    height: number;
    mediaType: "image/jpeg" | "image/png" | "image/webp";
    width: number;
  };
  normalized: {
    bytesBase64: string;
    checksum: `sha256:${string}`;
    height: number;
    mediaType: "image/webp";
    width: number;
  };
}

interface VoiceoverReadResult {
  buffer: ArrayBuffer;
  hex: string;
}

interface VoiceoverWorkerSuccess extends VoiceoverReadResult {
  ok: true;
}

interface VoiceoverWorkerFailure {
  message: string;
  ok: false;
}

type VoiceoverWorkerResponse = VoiceoverWorkerFailure | VoiceoverWorkerSuccess;

interface VoiceoverValidationOptions {
  signal?: AbortSignal;
}

const supportedExtensions = new Set(["aac", "flac", "m4a", "mp3", "wav"]);
const supportedMimeTypes = new Set([
  "audio/aac",
  "audio/flac",
  "audio/m4a",
  "audio/mp4",
  "audio/mpeg",
  "audio/wav",
  "audio/x-flac",
  "audio/x-m4a",
  "audio/x-wav",
]);

function extensionOf(filename: string): string {
  return filename.split(".").pop()?.toLowerCase() ?? "";
}

export function detectAudioContainer(
  bytes: Uint8Array,
): "AAC" | "FLAC" | "M4A" | "MP3" | "WAV" | null {
  if (bytes.length >= 12) {
    const ascii = (start: number, end: number) => String.fromCharCode(...bytes.slice(start, end));
    if (ascii(0, 4) === "RIFF" && ascii(8, 12) === "WAVE") return "WAV";
    if (ascii(0, 4) === "fLaC") return "FLAC";
    if (ascii(4, 8) === "ftyp") return "M4A";
  }
  if (bytes.length >= 3 && String.fromCharCode(...bytes.slice(0, 3)) === "ID3") return "MP3";
  const firstByte = bytes[0];
  const secondByte = bytes[1];
  if (firstByte === 0xff && secondByte !== undefined && (secondByte & 0xf6) === 0xf0) {
    return "AAC";
  }
  if (firstByte === 0xff && secondByte !== undefined && (secondByte & 0xe0) === 0xe0) {
    return "MP3";
  }
  return null;
}

function containerMatchesExtension(
  container: NonNullable<ReturnType<typeof detectAudioContainer>>,
  extension: string,
) {
  if (container === "M4A") return extension === "m4a";
  return container.toLowerCase() === extension;
}

function abortError(): DOMException {
  return new DOMException("Voiceover validation was cancelled.", "AbortError");
}

async function readAndHashVoiceover(
  file: File,
  signal?: AbortSignal,
): Promise<VoiceoverReadResult> {
  if (signal?.aborted) throw abortError();

  if (typeof Worker === "undefined") {
    const buffer = await file.arrayBuffer();
    if (signal?.aborted) throw abortError();
    const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", buffer));
    const hex = Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join("");
    return { buffer, hex };
  }

  return new Promise<VoiceoverReadResult>((resolve, reject) => {
    const worker = new Worker(new URL("./media-validation-worker.ts", import.meta.url), {
      type: "module",
    });
    const stop = () => worker.terminate();
    const cancel = () => {
      stop();
      reject(abortError());
    };
    signal?.addEventListener("abort", cancel, { once: true });
    worker.onerror = () => {
      signal?.removeEventListener("abort", cancel);
      stop();
      reject(new Error("The voiceover validation worker failed. Choose the file again."));
    };
    worker.onmessage = (event: MessageEvent<VoiceoverWorkerResponse>) => {
      signal?.removeEventListener("abort", cancel);
      stop();
      if (event.data.ok) resolve({ buffer: event.data.buffer, hex: event.data.hex });
      else reject(new Error(event.data.message));
    };
    worker.postMessage({ file });
  });
}

export async function validateVoiceoverFile(
  file: File,
  options: VoiceoverValidationOptions = {},
): Promise<VerifiedVoiceover> {
  const extension = extensionOf(file.name);
  if (!supportedExtensions.has(extension)) {
    throw new Error("Use WAV, MP3, M4A/AAC, or FLAC audio.");
  }
  if (file.type && !supportedMimeTypes.has(file.type.toLowerCase())) {
    throw new Error("The selected file does not report a supported audio type.");
  }
  if (file.size === 0) throw new Error("The voiceover file is empty.");
  if (file.size > 1_000_000_000) throw new Error("Voiceover must be 1 GB or smaller.");

  const { buffer, hex } = await readAndHashVoiceover(file, options.signal);
  if (options.signal?.aborted) throw abortError();
  const container = detectAudioContainer(
    new Uint8Array(buffer, 0, Math.min(32, buffer.byteLength)),
  );
  if (!container || !containerMatchesExtension(container, extension)) {
    throw new Error("The file contents do not match its audio extension.");
  }

  const context = new AudioContext();
  let decoded: AudioBuffer;
  try {
    decoded = await context.decodeAudioData(buffer);
  } catch {
    throw new Error("The voiceover could not be decoded. Choose a complete audio file.");
  } finally {
    await context.close();
  }
  if (options.signal?.aborted) throw abortError();

  if (decoded.duration < 10 || decoded.duration > 3_600) {
    throw new Error("Voiceover duration must be between 10 seconds and 60 minutes.");
  }
  if (decoded.numberOfChannels < 1 || decoded.numberOfChannels > 2) {
    throw new Error("Use mono or stereo voiceover audio.");
  }
  if (decoded.sampleRate < 8_000 || decoded.sampleRate > 192_000) {
    throw new Error("The voiceover sample rate is outside the supported range.");
  }
  const hosted = ["staging", "production"].includes(import.meta.env.VITE_VIDEOFORGE_PROVIDER_MODE);
  const assetPrefix = hosted
    ? "browser_voiceover_sha256"
    : ["fixture", "voiceover", "sha256"].join("_");
  return {
    assetId: `${assetPrefix}_${hex}`,
    channels: decoded.numberOfChannels,
    checksum: `sha256:${hex}`,
    durationSeconds: decoded.duration,
    filename: file.name,
    sampleRate: decoded.sampleRate,
  };
}

export function formatDuration(seconds: number): string {
  const rounded = Math.round(seconds);
  return `${String(Math.floor(rounded / 60)).padStart(2, "0")}:${String(rounded % 60).padStart(2, "0")}`;
}

export function detectImageContainer(bytes: Uint8Array): "JPEG" | "PNG" | "WEBP" | null {
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  ) {
    return "PNG";
  }
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return "JPEG";
  }
  if (
    bytes.length >= 12 &&
    String.fromCharCode(...bytes.slice(0, 4)) === "RIFF" &&
    String.fromCharCode(...bytes.slice(8, 12)) === "WEBP"
  ) {
    return "WEBP";
  }
  return null;
}

function imageMediaType(container: NonNullable<ReturnType<typeof detectImageContainer>>) {
  if (container === "JPEG") return "image/jpeg" as const;
  if (container === "PNG") return "image/png" as const;
  return "image/webp" as const;
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  return btoa(binary);
}

async function sha256(bytes: Uint8Array): Promise<`sha256:${string}`> {
  const digest = new Uint8Array(
    await crypto.subtle.digest(
      "SHA-256",
      bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer,
    ),
  );
  return `sha256:${Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}

export function boundedImageDimensions(width: number, height: number, maximum = 1_600) {
  const scale = Math.min(1, maximum / Math.max(width, height));
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

export async function buildNormalizedStyleReference(
  file: File,
  sourceDimensions: { width: number; height: number },
  normalizedBlob: Blob,
  normalizedDimensions: { width: number; height: number },
  clientReferenceId: string = crypto.randomUUID(),
): Promise<NormalizedStyleReference> {
  const originalBytes = new Uint8Array(await file.arrayBuffer());
  const normalizedBytes = new Uint8Array(await normalizedBlob.arrayBuffer());
  const originalContainer = detectImageContainer(originalBytes.subarray(0, 16));
  if (!originalContainer) throw new Error(`${file.name} has unsupported image contents.`);
  if (detectImageContainer(normalizedBytes.subarray(0, 16)) !== "WEBP") {
    throw new Error(`${file.name} could not be normalized to WebP.`);
  }
  return {
    clientReferenceId,
    filename: file.name,
    height: normalizedDimensions.height,
    objectUrl: URL.createObjectURL(normalizedBlob),
    original: {
      bytesBase64: bytesToBase64(originalBytes),
      checksum: await sha256(originalBytes),
      height: sourceDimensions.height,
      mediaType: imageMediaType(originalContainer),
      width: sourceDimensions.width,
    },
    normalized: {
      bytesBase64: bytesToBase64(normalizedBytes),
      checksum: await sha256(normalizedBytes),
      height: normalizedDimensions.height,
      mediaType: "image/webp",
      width: normalizedDimensions.width,
    },
    width: normalizedDimensions.width,
  };
}

export async function normalizeImageStyleReference(file: File): Promise<NormalizedStyleReference> {
  const verified = await validateImageFile(file, 256);
  URL.revokeObjectURL(verified.objectUrl);
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file, {
      colorSpaceConversion: "default",
      imageOrientation: "from-image",
      premultiplyAlpha: "default",
    });
  } catch {
    throw new Error(`${file.name} could not be decoded for normalization.`);
  }
  const target = boundedImageDimensions(bitmap.width, bitmap.height);
  const canvas = document.createElement("canvas");
  canvas.width = target.width;
  canvas.height = target.height;
  const context = canvas.getContext("2d", { alpha: false, colorSpace: "srgb" });
  if (!context) {
    bitmap.close();
    throw new Error("This browser cannot normalize Image Style references.");
  }
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, target.width, target.height);
  context.drawImage(bitmap, 0, 0, target.width, target.height);
  bitmap.close();
  const normalizedBlob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error(`${file.name} normalization failed.`))),
      "image/webp",
      0.86,
    );
  });
  return buildNormalizedStyleReference(
    file,
    { width: verified.width, height: verified.height },
    normalizedBlob,
    target,
  );
}

export async function validateImageFile(
  file: File,
  minimumDimension = 512,
): Promise<VerifiedImage> {
  if (file.size === 0) throw new Error(`${file.name} is empty.`);
  if (file.size > 20_000_000) throw new Error(`${file.name} exceeds the 20 MB fixture limit.`);
  const extension = extensionOf(file.name);
  if (!["jpeg", "jpg", "png", "webp"].includes(extension)) {
    throw new Error(`${file.name} must be JPEG, PNG, or WebP.`);
  }
  const bytes = await file.arrayBuffer();
  const container = detectImageContainer(new Uint8Array(bytes.slice(0, 16)));
  const expected = extension === "jpg" || extension === "jpeg" ? "JPEG" : extension.toUpperCase();
  if (container !== expected) throw new Error(`${file.name} contents do not match its extension.`);

  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    throw new Error(`${file.name} could not be decoded as an image.`);
  }
  const { width, height } = bitmap;
  bitmap.close();
  if (width < minimumDimension || height < minimumDimension) {
    throw new Error(`${file.name} must be at least ${minimumDimension}×${minimumDimension}.`);
  }
  return { filename: file.name, height, objectUrl: URL.createObjectURL(file), width };
}
