import { createHash } from "node:crypto";

import type { HostedR2BucketBinding } from "./configuration";

const MAX_BUFFERED_R2_BODY_BYTES = 1_048_576;
const MAX_VERIFIED_OBJECTS = 256;

type HostedR2Head = NonNullable<Awaited<ReturnType<HostedR2BucketBinding["head"]>>>;
type HostedR2Object = NonNullable<Awaited<ReturnType<HostedR2BucketBinding["get"]>>>;

const verifiedObjects = new Map<string, string>();

function checksumFromR2(value?: ArrayBuffer): `sha256:${string}` | null {
  if (!value || value.byteLength !== 32) return null;
  return `sha256:${Buffer.from(value).toString("hex")}`;
}

function checksumFromBytes(value: Uint8Array): `sha256:${string}` {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

async function checksumFromBody(
  body: ReadableStream<Uint8Array>,
  expectedSize: number,
): Promise<`sha256:${string}` | null> {
  const digest = createHash("sha256");
  const reader = body.getReader();
  let size = 0;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > expectedSize) {
        await reader.cancel();
        return null;
      }
      digest.update(chunk.value);
    }
  } catch {
    return null;
  } finally {
    reader.releaseLock();
  }
  return size === expectedSize ? `sha256:${digest.digest("hex")}` : null;
}

async function checksumFromObject(object: HostedR2Object): Promise<`sha256:${string}` | null> {
  if (object.body) return checksumFromBody(object.body, object.size);
  if (object.size > MAX_BUFFERED_R2_BODY_BYTES || !object.arrayBuffer) return null;
  try {
    const bytes = new Uint8Array(await object.arrayBuffer());
    return bytes.byteLength === object.size ? checksumFromBytes(bytes) : null;
  } catch {
    return null;
  }
}

export async function verifyHostedObjectChecksum(
  bucket: HostedR2BucketBinding,
  objectKey: string,
  head: HostedR2Head,
  checksum: string,
): Promise<boolean> {
  const stored = checksumFromR2(head.checksums?.sha256);
  if (stored !== null) return stored === checksum;

  const identity = head.etag ? `${head.etag}:${head.size}:${checksum}` : null;
  if (identity && verifiedObjects.get(objectKey) === identity) return true;

  const object = await bucket.get(objectKey);
  if (!object || object.size !== head.size || (head.etag && object.etag !== head.etag))
    return false;
  if ((await checksumFromObject(object)) !== checksum) return false;

  if (identity) {
    if (verifiedObjects.size >= MAX_VERIFIED_OBJECTS)
      verifiedObjects.delete(verifiedObjects.keys().next().value!);
    verifiedObjects.set(objectKey, identity);
  }
  return true;
}
