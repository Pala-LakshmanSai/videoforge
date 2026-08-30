import type { AvatarProfileMetadata } from "./domain/preset-service";
import { inspectRaster } from "./domain/style-reference-validation";

export const MAX_AVATAR_SOURCE_BYTES = 20_000_000;
export const MAX_AVATAR_SOURCE_PIXELS = 20_000_000;

export interface ValidatedFixtureAvatarSource {
  readonly filename: string;
  readonly mediaType: "image/jpeg" | "image/png" | "image/webp";
  readonly checksum: `sha256:${string}`;
  readonly width: number;
  readonly height: number;
  readonly bytes: Uint8Array;
}

function decodeBase64(value: string): Uint8Array {
  if (value.length % 4 !== 0) throw new Error("Avatar source base64 has invalid padding.");
  let binary: string;
  try {
    binary = atob(value);
  } catch {
    throw new Error("Avatar source bytes are not valid base64.");
  }
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

async function digest(bytes: Uint8Array): Promise<`sha256:${string}`> {
  const hashed = new Uint8Array(
    await crypto.subtle.digest(
      "SHA-256",
      bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer,
    ),
  );
  return `sha256:${Array.from(hashed, (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}

export async function fixtureAvatarSourceChecksumMatches(
  source: Pick<ValidatedFixtureAvatarSource, "bytes" | "checksum">,
): Promise<boolean> {
  return (await digest(source.bytes)) === source.checksum;
}

function extensionMatchesMediaType(
  filename: string,
  mediaType: ValidatedFixtureAvatarSource["mediaType"],
): boolean {
  const extension = filename.slice(filename.lastIndexOf(".") + 1).toLowerCase();
  return (
    (mediaType === "image/jpeg" && ["jpg", "jpeg"].includes(extension)) ||
    (mediaType === "image/png" && extension === "png") ||
    (mediaType === "image/webp" && extension === "webp")
  );
}

/** Validate uploaded fixture bytes before retaining them in the owning session. */
export async function validateFixtureAvatarSource(
  metadata: AvatarProfileMetadata,
): Promise<ValidatedFixtureAvatarSource | null> {
  if (!metadata.source) return null;
  const bytes = decodeBase64(metadata.source.bytes_base64);
  if (bytes.byteLength === 0 || bytes.byteLength > MAX_AVATAR_SOURCE_BYTES) {
    throw new Error("Avatar source must be between 1 byte and 20 MB.");
  }
  if (!extensionMatchesMediaType(metadata.source.filename, metadata.source.media_type)) {
    throw new Error("Avatar source filename extension does not match its media type.");
  }
  if ((await digest(bytes)) !== metadata.source.checksum) {
    throw new Error("Avatar source checksum does not match its bytes.");
  }
  const facts = inspectRaster(bytes);
  if (!facts || facts.mediaType !== metadata.source.media_type) {
    throw new Error("Avatar source magic or raster metadata is invalid.");
  }
  const declared = metadata.source_dimensions;
  const dimensionsMatch = facts.width === declared.width && facts.height === declared.height;
  const jpegRotationMatch =
    facts.mediaType === "image/jpeg" &&
    facts.width === declared.height &&
    facts.height === declared.width;
  if (!dimensionsMatch && !jpegRotationMatch) {
    throw new Error("Avatar source dimensions do not match its decoded metadata.");
  }
  if (facts.width * facts.height > MAX_AVATAR_SOURCE_PIXELS) {
    throw new Error("Avatar source dimensions exceed the safe fixture limit.");
  }
  return {
    filename: metadata.source.filename,
    mediaType: metadata.source.media_type,
    checksum: metadata.source.checksum,
    width: declared.width,
    height: declared.height,
    bytes: bytes.slice(),
  };
}
